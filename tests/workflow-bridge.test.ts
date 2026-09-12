import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

function loadModule(path: string, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: any = {}
  runInNewContext(compiled, { exports, Error, CustomEvent, ...globals })
  return exports
}

const bridge = loadModule('../src/message/workflowBridge.ts')
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

function helper(): any {
  return {
    jobList: { value: [{ key: 'job-1', jobName: '脱敏岗位' }] },
    jobMaps: new Map([
      [
        'job-1',
        {
          jobData: { key: 'job-1', jobName: '脱敏岗位' },
          rawData: { privateRaw: 'must-not-travel' },
          state: { aiMatchResult: { decision: 'APPLY' } },
        },
      ],
    ]),
    jobResultMaps: new Map([['job-1', { status: 'ai', msg: '分析完成' }]]),
    currentJob: { value: 'job-1' },
    workflow: {
      status: { value: 'running' },
      current: { value: 1 },
      errorMessage: { value: null },
    },
    workflowRunning: { value: false },
    actionRunning: { value: false },
    collectionSummary: { value: { total: 1, stages: {} } },
    logs: { value: Array.from({ length: 23 }, (_, index) => ({ message: `日志 ${index}` })) },
    _logs: { value: [] },
    conf: { formData: { apiKey: 'must-not-travel' }, confInit: async () => {} },
    models: { initModel: async () => {} },
    start: async () => {},
    retryJob: async () => {},
    deliverJob: async () => {},
    stop() {},
    reset() {},
  }
}

function panelHarness(send: (tabId: number, message: any) => Promise<unknown>) {
  let activeTab = 11
  let queries = 0
  let nextTimer = 0
  const timers = new Map<number, () => void>()
  const notifications: unknown[] = []
  const panel = loadModule('../src/message/sidepanelWorkflow.ts', {
    require: (name: string) => {
      if (name === './workflowBridge') return bridge
      if (name === '@/services/appToast')
        return { useAppToast: () => ({ add: (message: unknown) => notifications.push(message) }) }
      throw new Error(`Unexpected import: ${name}`)
    },
    setTimeout: (callback: () => void) => {
      timers.set(++nextTimer, callback)
      return nextTimer
    },
    clearTimeout: (id: number) => {
      timers.delete(id)
    },
  })
  const ctx = helper()
  const dispose = panel.connectSidepanelWorkflow(ctx, {
    tabs: {
      query: async () => {
        queries++
        return [{ id: activeTab, url: 'https://www.zhipin.com/web/geek/job' }]
      },
      sendMessage: send,
    },
  })
  return {
    ctx,
    dispose,
    timers,
    notifications,
    changeTab: (id: number) => {
      activeTab = id
    },
    queries: () => queries,
  }
}

void test('workflow snapshots exclude raw objects and configuration and detach transported state', () => {
  const ctx = helper()
  const snapshot = bridge.snapshotWorkflow(ctx)
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'actionRunning',
    'current',
    'currentJob',
    'error',
    'jobs',
    'logs',
    'records',
    'results',
    'states',
    'status',
    'summary',
  ])
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /rawData|privateRaw|apiKey|must-not-travel|formData/,
  )
  assert.equal(snapshot.logs.length, 20)
  assert.deepEqual(plain(snapshot.summary), ctx.collectionSummary.value)
  assert.equal(snapshot.actionRunning, false)
  assert.equal(snapshot.logs[0].message, '日志 3')
  snapshot.states[0][1].aiMatchResult.decision = 'REJECT'
  assert.equal(ctx.jobMaps.get('job-1').state.aiMatchResult.decision, 'APPLY')
})

void test('panel mirrors snapshots and pins start stop reset to its original tab', async () => {
  const calls: Array<{ tabId: number; command: string }> = []
  const snapshot = bridge.snapshotWorkflow(helper())
  const harness = panelHarness(async (tabId, message) => {
    assert.equal(message.channel, bridge.workflowChannel)
    calls.push({ tabId, command: message.command })
    return { snapshot }
  })
  try {
    await flush()
    assert.equal(harness.ctx.currentJob.value, snapshot.currentJob)
    assert.equal(harness.ctx.workflow.current.value, snapshot.current)
    assert.equal(harness.ctx.workflow.status.value, snapshot.status)
    assert.deepEqual(plain(harness.ctx.jobList.value), plain(snapshot.jobs))
    assert.deepEqual(plain([...harness.ctx.jobResultMaps]), plain(snapshot.results))
    assert.deepEqual(plain(harness.ctx.jobMaps.get('job-1').state), plain(snapshot.states[0][1]))
    assert.deepEqual(plain(harness.ctx.jobMaps.get('job-1').rawData), {})
    assert.deepEqual(plain(harness.ctx._logs.value), plain(snapshot.logs))

    harness.changeTab(22)
    await harness.ctx.start()
    harness.ctx.stop()
    harness.ctx.reset()
    await flush()
    assert.deepEqual(
      calls,
      ['snapshot', 'start', 'stop', 'reset'].map((command) => ({ tabId: 11, command })),
    )
    assert.equal(harness.queries(), 1)
  } finally {
    harness.dispose()
  }
})

void test('remote errors reach panel status and user commands notify while polling remains quiet', async () => {
  const harness = panelHarness(async () => ({ error: '页面未就绪' }))
  try {
    await flush()
    assert.equal(harness.ctx.workflow.status.value, 'error')
    assert.equal(harness.ctx.workflow.errorMessage.value, '页面未就绪')
    assert.equal(harness.notifications.length, 0)
    await harness.ctx.start()
    assert.equal(harness.notifications.length, 1)
    assert.equal((harness.notifications[0] as any).title, '页面未就绪')
  } finally {
    harness.dispose()
  }
})

void test('disposing cancels polling and ignores an already in-flight snapshot', async () => {
  const snapshot = bridge.snapshotWorkflow(helper())
  let resolve: (response: unknown) => void = () => {}
  let requests = 0
  const harness = panelHarness(async () => {
    requests++
    return new Promise((done) => {
      resolve = done
    })
  })
  await flush()
  harness.dispose()
  snapshot.current = 99
  resolve({ snapshot })
  await flush()
  assert.equal(harness.ctx.workflow.current.value, 1)
  assert.equal(harness.timers.size, 0)
  assert.equal(requests, 1)

  const settled = panelHarness(async () => ({ snapshot }))
  await flush()
  assert.equal(settled.timers.size, 1)
  const scheduled = [...settled.timers.values()][0]!
  settled.dispose()
  assert.equal(settled.timers.size, 0)
  scheduled()
  await flush()
  assert.equal(settled.timers.size, 0)
})

void test('page workflow returns initialization failures to the matching request', async () => {
  const script = new EventTarget()
  const ctx = helper()
  let starts = 0
  ctx.conf.confInit = async () => {
    throw new Error('配置读取失败')
  }
  ctx.start = async () => {
    starts++
  }
  bridge.providePageWorkflow(script, ctx)
  const response = new Promise<any>((resolve) => {
    script.addEventListener(
      `${bridge.workflowChannel}:response`,
      (event) => resolve(JSON.parse((event as CustomEvent).detail)),
      { once: true },
    )
  })
  script.dispatchEvent(
    new CustomEvent(`${bridge.workflowChannel}:request`, {
      detail: JSON.stringify({ id: 'request-7', command: 'start' }),
    }),
  )
  const result = await response
  assert.equal(result.id, 'request-7')
  assert.match(result.error, /配置读取失败/)
  assert.equal(starts, 0)
})

void test('disposing ignores a late command failure without showing a toast or updating state', async () => {
  let fail: (reason: unknown) => void = () => {}
  const harness = panelHarness(async (_, message) => {
    if (message.command === 'snapshot') return { snapshot: bridge.snapshotWorkflow(helper()) }
    return new Promise((_, reject) => {
      fail = reject
    })
  })
  await flush()
  const starting = harness.ctx.start()
  harness.dispose()
  fail(new Error('迟到的失败'))
  await starting
  assert.equal(harness.ctx.workflow.status.value, 'running')
  assert.equal(harness.ctx.workflow.errorMessage.value, null)
  assert.equal(harness.notifications.length, 0)
  assert.equal(harness.timers.size, 0)
})

void test('page stop cancels an initializing start and responds to both requests', async () => {
  const script = new EventTarget()
  const ctx = helper()
  let finishInit: () => void = () => {}
  const initializing = new Promise<void>((resolve) => {
    finishInit = resolve
  })
  ctx.conf.confInit = () => initializing
  let starts = 0
  let stops = 0
  ctx.start = async () => {
    starts++
  }
  ctx.stop = () => {
    stops++
  }
  const responses: any[] = []
  script.addEventListener(`${bridge.workflowChannel}:response`, (event) => {
    responses.push(JSON.parse((event as CustomEvent).detail))
  })
  bridge.providePageWorkflow(script, ctx)
  for (const command of ['start', 'stop']) {
    script.dispatchEvent(
      new CustomEvent(`${bridge.workflowChannel}:request`, {
        detail: JSON.stringify({ id: command, command }),
      }),
    )
  }
  finishInit()
  await flush()
  assert.equal(starts, 0)
  assert.equal(stops, 1)
  assert.equal(responses.length, 2)
  assert.ok(responses.find((response) => response.id === 'stop').snapshot)
  assert.match(responses.find((response) => response.id === 'start').error, /取消/)
})

function pageHarness(ctx = helper()) {
  const script = new EventTarget()
  bridge.providePageWorkflow(script, ctx)
  let requestId = 0
  return {
    ctx,
    request: (command: string, extra: Record<string, unknown> = {}) => {
      const id = String(++requestId)
      return new Promise<any>((resolve) => {
        const listener = (event: Event) => {
          const response = JSON.parse((event as CustomEvent).detail)
          if (response.id !== id) return
          script.removeEventListener(`${bridge.workflowChannel}:response`, listener)
          resolve(response)
        }
        script.addEventListener(`${bridge.workflowChannel}:response`, listener)
        script.dispatchEvent(
          new CustomEvent(`${bridge.workflowChannel}:request`, {
            detail: JSON.stringify({ id, command, ...extra }),
          }),
        )
      })
    },
  }
}

void test('page delivery requires explicit true confirmation and a known key before any action', async () => {
  const ctx = helper()
  const deliveries: string[] = []
  let initializations = 0
  ctx.conf.confInit = async () => {
    initializations++
  }
  ctx.deliverJob = async (key: string) => {
    deliveries.push(key)
  }
  const page = pageHarness(ctx)
  for (const confirmed of [undefined, false, 'true', 1]) {
    assert.match((await page.request('deliver', { key: 'job-1', confirmed })).error, /确认/)
  }
  assert.match((await page.request('deliver', { key: 'unknown', confirmed: true })).error, /已采集/)
  assert.match((await page.request('deliver', { confirmed: true })).error, /已采集/)
  assert.equal(deliveries.length, 0)
  assert.equal(initializations, 0)
  assert.match((await page.request('retry', { key: 'unknown' })).error, /已采集/)
  const retries: string[] = []
  ctx.retryJob = async (key: string) => {
    retries.push(key)
  }
  assert.ok((await page.request('retry', { key: 'job-1' })).snapshot)
  await flush()
  assert.deepEqual(retries, ['job-1'])
  assert.ok((await page.request('deliver', { key: 'job-1', confirmed: true })).snapshot)
  assert.deepEqual(deliveries, ['job-1'])
  assert.equal(initializations, 2)
})

void test('panel retries and delivers one keyed job on the originally connected tab', async () => {
  const calls: Array<{ tabId: number; command: string; key?: string; confirmed?: boolean }> = []
  const snapshot = bridge.snapshotWorkflow(helper())
  const harness = panelHarness(async (tabId, { command, key, confirmed }) => {
    calls.push({ tabId, command, key, confirmed })
    return { snapshot }
  })
  try {
    await flush()
    harness.changeTab(22)
    await harness.ctx.retryJob('job-1')
    await harness.ctx.deliverJob('job-1')
    assert.deepEqual(calls.slice(1), [
      { tabId: 11, command: 'retry', key: 'job-1', confirmed: undefined },
      { tabId: 11, command: 'deliver', key: 'job-1', confirmed: true },
    ])
    assert.equal(harness.queries(), 1)
  } finally {
    harness.dispose()
  }
})

void test('snapshot history is mirrored into jobMaps without expanding the current page list', async () => {
  const ctx = helper()
  ctx.actionRunning.value = true
  ctx.jobMaps.set('previous-page', {
    jobData: { key: 'previous-page', jobName: '上一页岗位' },
    rawData: { privateRaw: 'must-not-travel' },
    state: { aiMatchResult: { decision: 'REVIEW' } },
  })
  const snapshot = bridge.snapshotWorkflow(ctx)
  assert.equal(snapshot.records.length, 2)
  assert.equal(snapshot.jobs.length, 1)
  assert.doesNotMatch(JSON.stringify(snapshot.records), /rawData|must-not-travel/)
  const harness = panelHarness(async () => ({ snapshot }))
  try {
    await flush()
    assert.equal(harness.ctx.jobMaps.size, 2)
    assert.equal(harness.ctx.jobMaps.get('previous-page').state.aiMatchResult.decision, 'REVIEW')
    assert.deepEqual(plain(harness.ctx.jobList.value.map((job: any) => job.key)), ['job-1'])
    assert.equal(harness.ctx.actionRunning.value, true)
  } finally {
    harness.dispose()
  }
})

void test('a running or initializing page operation rejects new start retry and deliver commands', async () => {
  const ctx = helper()
  let operations = 0
  ctx.start =
    ctx.retryJob =
    ctx.deliverJob =
      async () => {
        operations++
      }
  ctx.workflowRunning.value = true
  const page = pageHarness(ctx)
  for (const command of ['start', 'retry', 'deliver']) {
    assert.match(
      (await page.request(command, { key: 'job-1', confirmed: true })).error,
      /已有任务运行/,
    )
  }
  assert.equal(operations, 0)
  ctx.workflowRunning.value = false
  let finishInit: () => void = () => {}
  ctx.conf.confInit = () =>
    new Promise<void>((resolve) => {
      finishInit = resolve
    })
  const initializing = page.request('start')
  for (const command of ['start', 'retry', 'deliver']) {
    assert.match(
      (await page.request(command, { key: 'job-1', confirmed: true })).error,
      /已有任务运行/,
    )
  }
  finishInit()
  await initializing
  assert.equal(operations, 1)
})
