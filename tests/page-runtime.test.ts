import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

import { run } from '../src/index.ts'

test('BOSS page initializes bindings once without touching host layout, including sidebar reopen', async () => {
  const source = readFileSync(new URL('../src/entrypoints/boss/index.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: any = {}
  const warnings: unknown[] = []
  const root = { page: 'real-page-binding-stub' }
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === '#imports') return { defineUnlistedScript: (fn: unknown) => fn }
      if (name === '@/composables/useHelper') return { HelperContext: class {} }
      if (name === '@/composables/useVue')
        return {
          useHookVueFn: () => async () => {},
          getRootVue: async () => root,
        }
      if (name === '@/utils/logger')
        return { logger: { warn: (...args: unknown[]) => warnings.push(args) } }
      return {}
    },
    document: new Proxy(
      {},
      {
        get() {
          throw new Error('Unexpected host DOM mutation/access')
        },
      },
    ),
  })
  const ctx = Object.create(exports.BossHelperCtx.prototype)
  const calls: string[] = []
  for (const method of [
    '_initPage',
    '_initPageChange',
    '_initJobDetail',
    '_initClickJobCardAction',
    '_initJobList',
  ]) {
    ctx[method] = async () => {
      calls.push(method)
    }
  }
  await Promise.all([ctx.onMount(), ctx.onMount()])
  await ctx.onMount()
  assert.equal(ctx.rootVue, root)
  assert.equal(calls.length, 5)
  assert.deepEqual(warnings, [])
})

test('page runtime loads saved settings and models before binding without a DOM or Vue app', async () => {
  const events: string[] = []
  const ctx = {
    conf: {
      confInit: async () => {
        events.push('config')
      },
    },
    models: {
      initModel: async () => {
        events.push('models')
      },
    },
    onMount: async () => {
      events.push('bindings')
    },
  }
  // Running in Node deliberately provides no document, customElements or window.
  await run(ctx as never)
  assert.deepEqual(events, ['config', 'models', 'bindings'])
})

test('page runtime does not bind when initialization rejects', async () => {
  let mounted = false
  await assert.rejects(
    run({
      conf: {
        confInit: async () => {
          throw new Error('storage unavailable')
        },
      },
      models: { initModel: async () => {} },
      onMount: async () => {
        mounted = true
      },
    } as never),
    /storage unavailable/,
  )
  assert.equal(mounted, false)
})

void test('a failed binding can recover on a later mount, sharing concurrent attempts', async () => {
  const source = readFileSync(new URL('../src/entrypoints/boss/index.ts', import.meta.url), 'utf8')
  const exports: any = {}
  let roots = 0
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(compiled, {
    exports,
    require(name: string) {
      if (name === '#imports') return { defineUnlistedScript: (fn: unknown) => fn }
      if (name === '@/composables/useHelper') return { HelperContext: class {} }
      if (name === '@/composables/useVue')
        return {
          useHookVueFn: () => async () => {},
          getRootVue: async () => {
            if (++roots === 1) throw Error('not mounted')
            return {}
          },
        }
      if (name === '@/utils/logger') return { logger: { warn() {} } }
      return {}
    },
  })
  const ctx = Object.create(exports.BossHelperCtx.prototype)
  let bindings = 0
  for (const method of [
    '_initPage',
    '_initPageChange',
    '_initJobDetail',
    '_initClickJobCardAction',
    '_initJobList',
  ])
    ctx[method] = async () => {
      bindings++
    }
  await Promise.all([ctx.onMount(), ctx.onMount()])
  assert.equal(roots, 1)
  assert.equal(bindings, 0)
  // Advance past the real retry cooldown without sleeping in the test.
  ctx.nextBindingRetryAt = 0
  await Promise.all([ctx.onMount(), ctx.onMount()])
  await ctx.onMount()
  assert.equal(roots, 2)
  assert.equal(bindings, 5)
})

void test('single progress reread updates only the selected job and releases its operation lock', async () => {
  const source = ts.createSourceFile(
    'boss.ts',
    readFileSync(new URL('../src/entrypoints/boss/index.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const ctxClass = source.statements.find(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === 'BossHelperCtx',
  )!
  const method = ctxClass.members.find(
    (node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && node.name.getText(source) === 'refreshProgress',
  )!
  const exports: any = {}
  let reads = 0
  runInNewContext(
    ts.transpileModule(
      `exports.refresh = class { ${method.getText(source)} }.prototype.refreshProgress`,
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      },
    ).outputText,
    {
      exports,
      readJobFromFeishu: async (id: string) => {
        reads++
        assert.equal(id, 'job-id')
        return { recordId: 'remote-id', applicationProgress: '面试中', checkedAt: 123 }
      },
    },
  )
  const data = { rawData: { jobitem: { encryptJobId: 'job-id' } }, state: {} as any }
  const ctx: any = {
    starting: false,
    workflowRunning: { value: false },
    actionRunning: { value: false },
    jobMaps: new Map([['job', data]]),
    conf: { confInit: async () => {}, formData: { feishu: { enable: true } } },
  }
  await exports.refresh.call(ctx, 'job')
  assert.equal(data.state.feishuRecord.applicationProgress, '面试中')
  assert.equal(data.state.feishuRecordId, 'remote-id')
  assert.equal(ctx.actionRunning.value, false)
  ctx.conf.formData.feishu.enable = false
  await assert.rejects(exports.refresh.call(ctx, 'job'), /启用/)
  assert.equal(reads, 1)
  assert.equal(ctx.actionRunning.value, false)
})
