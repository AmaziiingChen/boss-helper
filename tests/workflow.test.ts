import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'
import * as vue from 'vue'

// Load the real workflow in isolation from the browser-only task registry.
const source = readFileSync(
  new URL('../src/composables/useApplying/index.ts', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function setup() {
  const logger = { withContext: () => logger, error() {}, warn() {}, debug() {} }
  const module = { exports: {} as any }
  runInNewContext(compiled, {
    exports: module.exports,
    Error,
    require: (name: string) => {
      if (name === 'vue') return vue
      if (name === './handles') return { DependencyMissingError: class extends Error {} }
      if (name === './type') {
        return {
          jobStatusList: [
            'pending',
            'wait',
            'running',
            'request',
            'ai',
            'success',
            'warn',
            'error',
          ],
        }
      }
      throw new Error(`Unexpected import: ${name}`)
    },
    logger,
    alert() {},
    jsonClone: (value: unknown) => value,
    delay: async () => {},
  })
  const helper = {
    jobList: vue.ref([{ key: 'job-1', jobName: '测试岗位' }]),
    jobResultMaps: new Map(),
    jobMaps: new Map(),
    currentJob: vue.ref(''),
    statistics: { todayData: vue.ref({ total: 0, success: 0, tasks: {} }) },
    conf: { formData: { deliveryLimit: { value: 10 } } },
    loadMoreJob: async () => false,
    notification: async () => {},
  }
  return { createWorkflow: module.exports.useDeliveryWorkflow, helper }
}

function task(id: string, handler: () => unknown) {
  return { id, label: id, deps: [], before: [], after: [], task: handler }
}

void test('pausing in a task does not mark success and resume processes the unfinished job', async () => {
  const { createWorkflow, helper } = setup()
  let firstRuns = 0
  let laterRuns = 0
  let hookRuns = 0
  let workflow: any
  workflow = await createWorkflow(
    [
      task('详情', () => ({
        fn: async () => {
          firstRuns++
          if (firstRuns === 1) workflow.stop()
        },
        after: [
          async () => {
            hookRuns++
          },
        ],
      })),
      task('入库', () => async () => {
        laterRuns++
      }),
    ],
    helper,
  )
  await workflow.executeAll(new Map())
  assert.equal(helper.statistics.todayData.value.success, 0)
  assert.equal(helper.jobResultMaps.get('job-1').status, 'wait')
  assert.equal(laterRuns, 0)
  assert.equal(hookRuns, 0)

  await workflow.executeAll(new Map())
  assert.equal(firstRuns, 2)
  assert.equal(workflow.mode, 'delivery')
  assert.equal(laterRuns, 1)
  assert.equal(hookRuns, 1)
  assert.equal(helper.statistics.todayData.value.success, 1)
  assert.equal(helper.jobResultMaps.get('job-1').status, 'success')
})

void test('a failed initializer blocks all execution and preserves its error until configuration is fixed', async () => {
  const { createWorkflow, helper } = setup()
  let configured = false
  let analysisRuns = 0
  let syncRuns = 0
  const workflow = await createWorkflow(
    [
      task('AI筛选', () => {
        if (!configured) throw new Error('请先填写简历')
        return async () => {
          analysisRuns++
        }
      }),
      task('入库', () => async () => {
        syncRuns++
      }),
    ],
    helper,
  )

  await workflow.executeAll(new Map())
  assert.equal(workflow.status.value, 'error')
  assert.match(workflow.errorMessage.value, /AI筛选.*请先填写简历/)
  assert.equal(workflow.nodes.value[0].status, 'failed')
  assert.equal(workflow.pipeline.value[0].id, 'AI筛选')
  assert.equal(helper.statistics.todayData.value.total, 0)
  assert.equal(analysisRuns, 0)
  assert.equal(syncRuns, 0)
  await workflow.execute({ jobData: helper.jobList.value[0], rawData: {}, state: {} })
  assert.equal(syncRuns, 0)

  configured = true
  await workflow.executeAll(new Map())
  assert.equal(workflow.errorMessage.value, null)
  assert.equal(analysisRuns, 1)
  assert.equal(syncRuns, 1)
  assert.equal(helper.statistics.todayData.value.success, 1)
})

void test('stop during asynchronous initialization prevents execution and allows a later restart', async () => {
  const { createWorkflow, helper } = setup()
  let finishInit: () => void = () => {}
  const initializing = new Promise<void>((resolve) => {
    finishInit = resolve
  })
  let runs = 0
  const workflow = await createWorkflow(
    [
      task('AI初始化', async () => {
        await initializing
        return async () => {
          runs++
        }
      }),
    ],
    helper,
  )
  const running = workflow.executeAll(new Map())
  workflow.stop()
  finishInit()
  await running
  assert.equal(workflow.status.value, 'stop')
  assert.equal(runs, 0)
  assert.equal(helper.statistics.todayData.value.total, 0)
  assert.equal(helper.statistics.todayData.value.success, 0)

  await workflow.executeAll(new Map())
  assert.equal(runs, 1)
  assert.equal(helper.statistics.todayData.value.success, 1)
})

void test('collection completion does not count as delivery or stop at an exhausted delivery quota', async () => {
  const { createWorkflow, helper } = setup()
  helper.jobList.value.push({ key: 'job-2', jobName: '第二岗位' })
  helper.statistics.todayData.value.success = 10
  helper.conf.formData.deliveryLimit.value = 1
  let collected = 0
  const workflow = await createWorkflow(
    [
      task('采集', () => async () => {
        collected++
      }),
    ],
    helper,
    { mode: 'collection' },
  )
  await workflow.executeAll(new Map())
  assert.equal(workflow.mode, 'collection')
  assert.equal(collected, 2)
  assert.equal(helper.statistics.todayData.value.success, 10)
  for (const job of helper.jobList.value) {
    assert.equal(helper.jobResultMaps.get(job.key).status, 'success')
    assert.equal(helper.jobResultMaps.get(job.key).msg, '采集处理完成')
  }
})

void test('collection retries retain existing job state and completed stages through reset', async () => {
  const { createWorkflow, helper } = setup()
  helper.jobMaps.set('job-1', { state: { detailReady: true } })
  let analyses = 0
  let syncAttempts = 0
  const workflow = await createWorkflow(
    [
      task('分析', () => async (_: unknown, { state }: any) => {
        assert.equal(state.detailReady, true)
        if (state.analysisReady) return
        analyses++
        state.analysisReady = true
      }),
      task('入库', () => async (_: unknown, { state }: any) => {
        assert.equal(state.analysisReady, true)
        syncAttempts++
        if (syncAttempts === 1) throw new Error('暂时失败')
        state.synced = true
      }),
    ],
    helper,
    { mode: 'collection' },
  )
  await workflow.executeAll(new Map())
  assert.equal(helper.jobResultMaps.get('job-1').status, 'error')
  assert.equal(workflow.stateMaps.value.get('job-1').analysisReady, true)
  workflow.reset()
  // A refreshed list can recreate jobMaps; retained workflow state takes precedence.
  helper.jobMaps.set('job-1', { state: {} })
  await workflow.executeAll(new Map())
  assert.equal(analyses, 1)
  assert.equal(syncAttempts, 2)
  assert.equal(workflow.stateMaps.value.get('job-1').synced, true)
  assert.equal(helper.jobResultMaps.get('job-1').status, 'success')
  assert.equal(helper.statistics.todayData.value.success, 0)
})
