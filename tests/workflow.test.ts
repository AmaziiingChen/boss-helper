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

function setup(randomValues = [0.5]) {
  const waits: number[] = []
  let randomIndex = 0
  const logger = { withContext: () => logger, error() {}, warn() {}, debug() {} }
  const module = { exports: {} as any }
  runInNewContext(compiled, {
    exports: module.exports,
    Error,
    Math: Object.assign(Object.create(Math), {
      random: () => randomValues[randomIndex++ % randomValues.length],
    }),
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
    delay: async (seconds: number) => {
      waits.push(seconds)
    },
  })
  const helper = {
    jobList: vue.ref([{ key: 'job-1', jobName: '测试岗位' }]),
    jobResultMaps: new Map(),
    jobMaps: new Map(),
    currentJob: vue.ref(''),
    statistics: { todayData: vue.ref({ total: 0, success: 0, tasks: {} }) },
    conf: {
      formData: {
        deliveryLimit: { value: 10 },
        aiFiltering: { enable: false },
        delayDeliveryStarts: 3,
        delayDeliveryInterval: 5,
        delayDeliveryPageNext: 60,
      },
    },
    loadMoreJob: async () => false,
    notification: async () => {},
  }
  return { createWorkflow: module.exports.useDeliveryWorkflow, helper, waits }
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

for (const scenario of [
  { mode: 'collection', ai: false, expected: [1, 5, 5, 60] },
  { mode: 'collection', ai: true, expected: [3, 5, 5, 60] },
  { mode: 'delivery', ai: false, expected: [3, 5, 5, 60] },
] as const) {
  void test(`${scenario.mode} with AI=${scenario.ai} uses the appropriate pacing and collects every job`, async () => {
    const { createWorkflow, helper, waits } = setup()
    helper.conf.formData.aiFiltering.enable = scenario.ai
    helper.jobList.value.push({ key: 'job-2', jobName: '第二岗位' })
    const collected: string[] = []
    const workflow = await createWorkflow(
      [
        task('详情与入库', () => async (_: unknown, { jobData }: any) => {
          collected.push(jobData.key)
        }),
      ],
      helper,
      { mode: scenario.mode },
    )
    await workflow.executeAll(new Map())
    assert.deepEqual(waits, scenario.expected)
    assert.deepEqual(collected, ['job-1', 'job-2'])
  })
}

void test('collection enforces minimum request pauses for short configured delays', async () => {
  const { createWorkflow, helper, waits } = setup()
  helper.conf.formData.delayDeliveryStarts = 0
  helper.conf.formData.delayDeliveryInterval = 0.5
  helper.conf.formData.delayDeliveryPageNext = 2
  const workflow = await createWorkflow([task('采集', () => async () => {})], helper, {
    mode: 'collection',
  })
  await workflow.executeAll(new Map())
  assert.deepEqual(waits, [0, 5, 15])
})

void test('pause while waiting for the next page does not report end of results', async () => {
  const { createWorkflow, helper } = setup()
  const workflow = await createWorkflow([task('采集', () => async () => {})], helper, {
    mode: 'collection',
  })
  let message = ''
  helper.loadMoreJob = async () => {
    workflow.stop()
    return false
  }
  helper.notification = async (value: string) => {
    message = value
  }
  await workflow.executeAll(new Map())
  assert.doesNotMatch(message, /未发现.*下一页/)
})

for (const ai of [false, true]) {
  void test(`collection with AI=${ai} chooses a fresh bounded random delay for every action`, async () => {
    const { createWorkflow, helper, waits } = setup([0, 0.25, 0.75, 0.5])
    helper.conf.formData.aiFiltering.enable = ai
    helper.jobList.value.push({ key: 'job-2', jobName: '第二岗位' })
    const workflow = await createWorkflow([task('采集', () => async () => {})], helper, {
      mode: 'collection',
    })
    await workflow.executeAll(new Map())
    const bases = ai ? [3, 5, 5, 60] : [1, 5, 5, 60]
    const factors = [0.8, 0.9, 1.1, 1]
    waits.forEach((seconds, index) => {
      assert.ok(Math.abs(seconds - bases[index]! * factors[index]!) < 1e-9)
      assert.ok(seconds >= bases[index]! * 0.8 && seconds <= bases[index]! * 1.2)
    })
    assert.equal(waits.length, 4)
    assert.notEqual(waits[1], waits[2])
    assert.equal(helper.jobResultMaps.get('job-2').status, 'success')
  })
}

void test('collection pacing averages around its minimum interval; delivery keeps its configured timing', async () => {
  for (const mode of ['collection', 'delivery'] as const) {
    const { createWorkflow, helper, waits } = setup([0, 0.999999])
    helper.conf.formData.deliveryLimit.value = 100
    helper.jobList.value = Array.from({ length: 10 }, (_, index) => ({
      key: `job-${index}`,
      jobName: '测试岗位',
    }))
    const workflow = await createWorkflow([task('采集', () => async () => {})], helper, { mode })
    await workflow.executeAll(new Map())
    const jobWaits = waits.slice(1, -1)
    const average = jobWaits.reduce((total, seconds) => total + seconds, 0) / jobWaits.length
    if (mode === 'collection') assert.ok(Math.abs(average - 5) < 1e-5)
    else assert.deepEqual(jobWaits, Array(10).fill(5))
  }
})

void test('a Feishu cache skip avoids the BOSS job pause while the next new job keeps it', async () => {
  const { createWorkflow, helper, waits } = setup()
  helper.jobList.value.push({ key: 'job-2', jobName: '新岗位' })
  const workflow = await createWorkflow(
    [
      task('查重', () => async (_: unknown, { jobData }: any) => {
        if (jobData.key === 'job-1') return { isSkip: true, isCache: true, status: 'warn' }
      }),
    ],
    helper,
    { mode: 'collection' },
  )
  await workflow.executeAll(new Map())
  assert.deepEqual(waits, [1, 5, 60])
  assert.equal(helper.jobResultMaps.get('job-1').status, 'warn')
  assert.equal(helper.jobResultMaps.get('job-2').status, 'success')
})
