import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'
import * as vue from 'vue'

import * as greeting from '../src/services/greeting.ts'
import { hasResumeContent } from '../src/utils/workbenchState.ts'

void test('greeting validates model output and versions without treating invalid output as a draft', async () => {
  assert.equal(
    greeting.parseGreetingOutput('{"status":"ready","text":"您好，我做过相关项目。","reason":""}'),
    '您好，我做过相关项目。',
  )
  for (const value of [
    '',
    null,
    'not json',
    { status: 'ready', text: '', reason: '' },
    { status: 'ready', text: 'a'.repeat(501), reason: '' },
    { status: 'needs_info', text: '', reason: 'missing resume' },
    { status: 'ready', text: 'hi', reason: '', send: true },
  ])
    assert.throws(() => greeting.parseGreetingOutput(value))
  assert.notEqual(
    await greeting.greetingHash('resume-v1'),
    await greeting.greetingHash('resume-v2'),
  )
  assert.equal(greeting.isGreetingDraft({ text: 'hi' }), false)
})

function harness() {
  let mounted!: () => Promise<void>
  let unmount!: () => void
  let resolve!: (text: string) => void
  const writes: any[] = []
  let calls = 0
  let failSave = false
  const props = vue.reactive({
    job: {
      key: 'job1',
      link: 'https://example.com/job1',
      jobName: '产品实习',
      brand: { name: '示例团队' },
      jobDescription: '负责产品需求和原型',
      boss: { name: '示例招聘人', title: '招聘专员' },
    },
    busy: false,
  })
  const helper = {
    jobMaps: vue.reactive(new Map<string, any>([['job1', { state: {} }]])),
    sendGreeting: async (_key: string, _request: any) => {},
    conf: {
      formData: vue.reactive({
        resumeMarkdown: { content: '# 经历\n负责产品原型设计', fileName: 'resume.md' },
        aiFiltering: { model: 'model' },
        feishu: { appToken: 'base', tableId: 'table' },
      }),
    },
    models: {
      modelData: vue.ref([
        {
          key: 'model',
          data: { api_key: 'fake-key', base_url: 'https://example.invalid', model: 'fake-model' },
        },
      ]),
    },
    chatModel: {
      createAgent() {
        return true
      },
      async chat() {
        calls++
        return {
          text: new Promise<string>((r) => {
            resolve = r
          }),
        }
      },
    },
  }
  const source = readFileSync(
    new URL('../src/components/AI/GreetingDraft.vue', import.meta.url),
    'utf8',
  ).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const code = ts.transpileModule(
    `${source}\nObject.assign(exposed, { generate, saveDraft, draft, error, notice, stale, style, generating, reviewGreeting, review, reviewVisible, confirmSend, defaultGreetingDisabled, sendRecord });`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const exposed: any = {}
  const scope = vue.effectScope()
  scope.run(() =>
    runInNewContext(code, {
      exports: {},
      exposed,
      defineProps: () => props,
      require(name: string) {
        if (name === 'vue')
          return {
            ...vue,
            onMounted: (f: any) => {
              mounted = f
            },
            onBeforeUnmount: (f: any) => {
              unmount = f
            },
          }
        if (name === '@/composables/useHelper') return { useHelper: () => helper }
        if (name === '@/services/greeting') return greeting
        if (name === '@/utils/workbenchState') return { hasResumeContent }
        if (name === '@/message')
          return {
            counter: {
              storageGet: async () => null,
              storageSet: async (...args: any[]) => {
                if (failSave) throw Error('offline')
                writes.push(args)
              },
            },
          }
        if (name.startsWith('primevue/')) return {}
        throw Error(`Unexpected import ${name}`)
      },
    }),
  )
  return {
    exposed,
    helper,
    props,
    writes,
    mounted: () => mounted(),
    resolve: (text: string) => resolve(text),
    calls: () => calls,
    failSave: () => {
      failSave = true
    },
    dispose: () => {
      unmount()
      scope.stop()
    },
  }
}

void test('draft generation is explicit, preserves edits on failure, rejects stale results and saves locally only', async () => {
  const h = harness()
  try {
    await h.mounted()
    assert.equal(h.calls(), 0)
    const first = h.exposed.generate()
    await h.exposed.generate()
    assert.equal(h.calls(), 1)
    h.resolve('{"status":"ready","text":"您好，我有产品原型项目经验。","reason":""}')
    await first
    assert.equal(h.writes.length, 0)
    h.exposed.draft.value.text = '人工修改的招呼语'
    await h.exposed.saveDraft()
    assert.equal(h.writes.length, 1)
    assert.equal(h.writes[0][1].text, '人工修改的招呼语')
    assert.equal(JSON.stringify(h.writes).includes('fake-key'), false)
    assert.equal(JSON.stringify(h.writes).includes('# 经历'), false)
    const second = h.exposed.generate()
    h.resolve('bad response')
    await second
    assert.equal(h.exposed.draft.value.text, '人工修改的招呼语')
    h.failSave()
    await h.exposed.saveDraft()
    assert.match(h.exposed.error.value, /保存失败/)
    const third = h.exposed.generate()
    h.helper.conf.formData.resumeMarkdown.content += '新经历'
    await vue.nextTick()
    h.resolve('{"status":"ready","text":"迟到结果","reason":""}')
    await third
    assert.equal(h.exposed.draft.value.text, '人工修改的招呼语')
    assert.equal(h.exposed.stale.value, true)
    await h.exposed.saveDraft()
    assert.equal(h.writes.length, 1)
  } finally {
    h.dispose()
  }
})

void test('sending requires a fresh review and unchecked-by-default explicit consent; exact edits are sent once', async () => {
  const h = harness()
  const sends: any[] = []
  try {
    h.helper.sendGreeting = async (key, request) => {
      sends.push({ key, request })
      h.helper.jobMaps.get(key).state.greetingSend = { status: 'sending' }
    }
    await h.mounted()
    const pending = h.exposed.generate()
    h.resolve('{"status":"ready","text":"您好，我有产品原型经验。","reason":""}')
    await pending
    h.exposed.draft.value.text = '用户编辑后的精确原文\n第二行'
    h.exposed.reviewGreeting()
    await h.exposed.confirmSend()
    assert.equal(sends.length, 0)
    h.exposed.defaultGreetingDisabled.value = true
    await h.exposed.confirmSend()
    await h.exposed.confirmSend()
    assert.equal(sends.length, 1)
    assert.equal(sends[0].request.text, '用户编辑后的精确原文\n第二行')
    assert.equal(sends[0].request.recruiter, '示例招聘人')
    assert.equal(sends[0].request.defaultGreetingDisabled, true)
    h.helper.jobMaps.get('job1').state.greetingSend = { status: 'unknown' }
    await h.exposed.confirmSend()
    assert.equal(sends.length, 1)
  } finally {
    h.dispose()
  }
})

void test('floating review captures exact content without sending and closes when content or target changes', async () => {
  const h = harness()
  try {
    await h.mounted()
    const pending = h.exposed.generate()
    h.resolve('{"status":"ready","text":"您好，我有产品原型项目经验。","reason":""}')
    await pending
    h.exposed.reviewGreeting()
    assert.equal(h.exposed.reviewVisible.value, true)
    assert.equal(h.exposed.review.value.text, h.exposed.draft.value.text)
    assert.equal(h.exposed.review.value.company, '示例团队')
    assert.equal(h.writes.length, 0)
    assert.equal(h.calls(), 1)
    h.exposed.draft.value.text = '修改后的正文'
    assert.equal(h.exposed.reviewVisible.value, false)
    h.exposed.reviewGreeting()
    assert.equal(h.exposed.review.value.text, '修改后的正文')
    h.props.job.key = 'job2'
    assert.equal(h.exposed.reviewVisible.value, false)
    h.exposed.reviewGreeting()
    assert.equal(h.exposed.reviewVisible.value, false)
  } finally {
    h.dispose()
  }
})

void test('changing imported personal facts makes a generated greeting stale and closes its review', async () => {
  const h = harness()
  try {
    await h.mounted()
    await new Promise((resolve) => setImmediate(resolve))
    const pending = h.exposed.generate()
    h.resolve('{"status":"ready","text":"您好，我有相关工程项目经验。","reason":""}')
    await pending
    assert.equal(h.exposed.stale.value, false)
    h.exposed.reviewGreeting()
    assert.equal(h.exposed.reviewVisible.value, true)
    ;(h.helper.conf.formData as any).candidateProfile = {
      content: '新的职业偏好',
      fileName: 'matching-profile.json',
    }
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(h.exposed.stale.value, true)
    assert.equal(h.exposed.reviewVisible.value, false)
  } finally {
    h.dispose()
  }
})
