import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'
import * as vue from 'vue'

import { shouldDeliverJob } from '../src/services/jobMatching.ts'

// Exercise the production orchestration and stage runner, replacing only browser,
// network, and registry handlers. No BOSS, model or Feishu request leaves this test.
function setup(
  options: {
    decision?: 'APPLY' | 'REJECT'
    contact?: boolean
    blockedKeyword?: boolean
    aiEnabled?: boolean
    storageEnabled?: boolean
    invalidAi?: boolean
    invalidStorage?: boolean
    failStorageOnce?: boolean
    failSending?: boolean
  } = {},
) {
  const counts = { detail: 0, analysis: 0, storage: 0, send: 0, filters: 0 }
  const stored: any[] = []
  const logger = { withContext: () => logger, error() {}, warn() {}, debug() {} }
  function load(path: string, imports: Record<string, any>, exports: any = {}) {
    const source = readFileSync(new URL(`../src/${path}.ts`, import.meta.url), 'utf8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    runInNewContext(compiled, {
      exports,
      Error,
      require: (name: string) => {
        if (name in imports) return imports[name]
        throw new Error(`Unexpected import: ${name}`)
      },
      logger,
      alert() {},
      jsonClone: (value: unknown) => value,
      delay: async () => {},
    })
    return exports
  }
  const workflow: any = {}
  const handles: any = {
    DependencyMissingError: class extends Error {},
    taskResult: {
      skip: (reason: string) => ({ isSkip: true, reason, status: 'warn' }),
      error: (reason: string) => ({ isSkip: true, reason, status: 'error' }),
    },
  }
  const types = load('composables/useApplying/type', { '.': workflow, './handles': handles })
  load('composables/useApplying/index', { vue, './handles': handles, './type': types }, workflow)
  const stages = load('services/collectionStages', {})
  handles.TaskRegistry = class {
    constructor() {
      return new Proxy(this, {
        get: (_, name) => {
          if (name === 'aiFiltering') {
            return types.defineTaskHandler('AI筛选', () => {
              if (options.invalidAi) throw new Error('请先配置模型与简历')
              if (options.aiEnabled === false) return
              return async (_: unknown, data: any) => {
                counts.analysis++
                data.state.aiMatchResult = {
                  decision: options.decision ?? 'APPLY',
                  reason: '测试结论',
                  matchPoints: [],
                  gaps: [],
                  uncertainties: [],
                }
              }
            })
          }
          return types.defineTaskHandler(String(name), () => async () => {
            counts.filters++
            if (options.blockedKeyword) return handles.taskResult.skip('关键词排除')
          })
        },
      })
    }
  }
  const entry = load('entrypoints/boss/delivery', {
    '@/composables/useApplying': workflow,
    '@/composables/useApplying/type': types,
    '@/composables/useApplying/handles': handles,
    '@/services/collectionStages': stages,
    '@/services/jobMatching': { shouldDeliverJob },
    '@/services/feishu': {
      validateFeishuConfig() {
        if (options.invalidStorage) throw new Error('请配置飞书')
      },
      async upsertJobToFeishu(...args: any[]) {
        counts.storage++
        if (options.failStorageOnce && counts.storage === 1) throw new Error('飞书暂时不可用')
        stored.push(args)
        return { recordId: 'record-test' }
      },
    },
    './requests': {
      async sendPublishReq() {
        counts.send++
        if (options.failSending) throw new Error('发送响应丢失')
      },
    },
  })
  const job = { key: 'job-test', jobName: '测试岗位', jobDescription: '' }
  const raw = {
    jobitem: { encryptJobId: 'job-test', securityId: 'fake-security', contact: !!options.contact },
    detail: { jobInfo: {}, brandComInfo: {}, bossInfo: {} },
  }
  const helper: any = {
    jobList: vue.ref([job]),
    jobResultMaps: new Map(),
    jobMaps: new Map(),
    currentJob: vue.ref(''),
    statistics: { todayData: vue.ref({ total: 0, success: 0, tasks: {} }) },
    conf: {
      formData: {
        autoDelivery: { value: true },
        deliverReview: { value: false },
        bossGoldMedalHr: { value: false },
        deliveryLimit: { value: 10 },
        feishu: { enable: options.storageEnabled !== false },
      },
    },
    onJobCardClick: async () => {
      counts.detail++
      helper.jobList.value[0].jobDescription = '完整测试 JD'
    },
    loadMoreJob: async () => false,
    notification: async () => {},
  }
  const rawMap = new Map([[job.key, raw]])
  return {
    counts,
    stored,
    helper,
    rawMap,
    async collection() {
      helper.workflow = await entry.bossWorkflow(helper)
      return helper.workflow
    },
    async delivery(state: any) {
      helper.jobMaps.set(job.key, { state })
      helper.workflow = await entry.bossDeliveryWorkflow(helper)
      return helper.workflow
    },
    state: () => helper.jobMaps.get(job.key).state,
    result: () => helper.jobResultMaps.get(job.key),
  }
}

void test('collection ignores autoDelivery, contact and keyword filters and stores REJECT jobs', async () => {
  const fixture = setup({ decision: 'REJECT', contact: true, blockedKeyword: true })
  const workflow = await fixture.collection()
  await workflow.executeAll(fixture.rawMap)
  assert.equal(workflow.mode, 'collection')
  assert.deepEqual(fixture.counts, { detail: 1, analysis: 1, storage: 1, send: 0, filters: 0 })
  assert.equal(fixture.stored[0][2].decision, 'REJECT')
  assert.equal(fixture.stored[0][0].jobDescription, '完整测试 JD')
  assert.equal(fixture.state().delivered, false)
  assert.equal(fixture.state().stages.storage.status, 'succeeded')
  assert.equal(fixture.result().status, 'success')
  assert.equal(fixture.helper.statistics.todayData.value.success, 0)
})

void test('APPLY also never sends during collection with legacy autoDelivery enabled', async () => {
  const fixture = setup()
  const workflow = await fixture.collection()
  await workflow.executeAll(fixture.rawMap)
  assert.equal(fixture.state().aiMatchResult.decision, 'APPLY')
  assert.equal(fixture.counts.send, 0)
  assert.equal(fixture.helper.statistics.todayData.value.success, 0)
  assert.equal(fixture.result().status, 'success')
})

void test('storage failure retries storage only and retains successful detail and analysis', async () => {
  const fixture = setup({ failStorageOnce: true })
  const workflow = await fixture.collection()
  await workflow.executeAll(fixture.rawMap)
  assert.equal(fixture.result().status, 'error')
  assert.equal(fixture.state().stages.detail.status, 'succeeded')
  assert.equal(fixture.state().stages.analysis.status, 'succeeded')
  assert.equal(fixture.state().stages.storage.status, 'failed')
  const match = fixture.state().aiMatchResult
  await workflow.executeAll(fixture.rawMap)
  assert.deepEqual(fixture.counts, { detail: 1, analysis: 1, storage: 2, send: 0, filters: 0 })
  assert.deepEqual(fixture.state().aiMatchResult, match)
  assert.equal(fixture.state().feishuRecordId, 'record-test')
  assert.equal(fixture.state().stages.storage.attempts, 2)
  assert.equal(fixture.result().status, 'success')
  assert.equal(fixture.helper.statistics.todayData.value.success, 0)
})

void test('disabled AI and storage are explicitly skipped without blocking detail collection', async () => {
  const fixture = setup({ aiEnabled: false, storageEnabled: false })
  const workflow = await fixture.collection()
  await workflow.executeAll(fixture.rawMap)
  assert.equal(fixture.state().stages.detail.status, 'succeeded')
  assert.equal(fixture.state().stages.analysis.status, 'skipped')
  assert.equal(fixture.state().stages.storage.status, 'skipped')
  assert.deepEqual(fixture.counts, { detail: 1, analysis: 0, storage: 0, send: 0, filters: 0 })
  assert.equal(fixture.result().status, 'success')
  assert.equal(fixture.helper.statistics.todayData.value.success, 0)
})

for (const failure of ['invalidAi', 'invalidStorage'] as const) {
  void test(`${failure} prevents detail, analysis, storage and delivery before execution`, async () => {
    const fixture = setup({ [failure]: true })
    const workflow = await fixture.collection()
    await workflow.executeAll(fixture.rawMap)
    assert.equal(workflow.status.value, 'error')
    assert.ok(workflow.errorMessage.value)
    assert.deepEqual(fixture.counts, { detail: 0, analysis: 0, storage: 0, send: 0, filters: 0 })
    assert.equal(fixture.helper.statistics.todayData.value.total, 0)
  })
}

function readyToDeliver() {
  return {
    stages: {
      detail: { status: 'succeeded', attempts: 1 },
      analysis: { status: 'succeeded', attempts: 1 },
    },
    aiMatchResult: {
      decision: 'APPLY',
      reason: '匹配',
      matchPoints: [],
      gaps: [],
      uncertainties: [],
    },
  }
}

for (const previous of ['delivered', 'succeeded', 'unknown', 'running']) {
  void test(`explicit delivery refuses resending a ${previous} job`, async () => {
    const fixture = setup()
    const state: any = readyToDeliver()
    if (previous === 'delivered') state.delivered = true
    else state.stages.delivery = { status: previous, attempts: 1 }
    const workflow = await fixture.delivery(state)
    await workflow.executeAll(fixture.rawMap)
    assert.equal(fixture.counts.send, 0)
    assert.equal(fixture.counts.detail, 0)
    assert.equal(fixture.helper.statistics.todayData.value.success, 0)
    assert.equal(
      fixture.result().status,
      ['unknown', 'running'].includes(previous) ? 'error' : 'warn',
    )
  })
}

void test('a failed explicit send is marked unknown and cannot be retried automatically', async () => {
  const fixture = setup({ failSending: true })
  const workflow = await fixture.delivery(readyToDeliver())
  await workflow.executeAll(fixture.rawMap)
  assert.equal(fixture.counts.send, 1)
  assert.equal(fixture.state().stages.delivery.status, 'unknown')
  assert.equal(fixture.result().status, 'error')
  assert.equal(fixture.helper.statistics.todayData.value.success, 0)
  await workflow.executeAll(fixture.rawMap)
  assert.equal(fixture.counts.send, 1)
  assert.equal(fixture.state().stages.delivery.status, 'unknown')
  assert.equal(fixture.helper.statistics.todayData.value.success, 0)
})
