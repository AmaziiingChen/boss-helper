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
    invalidSchema?: boolean
    failStorageOnce?: boolean
    failSending?: boolean
    progress?: string
    missingRecord?: boolean
    failRead?: boolean
    existingRecord?: boolean
    failDetail?: boolean
  } = {},
) {
  const counts = { detail: 0, analysis: 0, storage: 0, send: 0, filters: 0 }
  const stored: any[] = []
  const lookups: string[] = []
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
      async validateFeishuSchema() {
        if (options.invalidSchema) throw new Error('飞书字段不兼容')
      },
      async readJobFromFeishu(id: string) {
        lookups.push(id)
        if (options.failRead) throw new Error('飞书回读失败')
        if (
          options.missingRecord ||
          (helper.workflow?.mode === 'collection' && !options.existingRecord)
        )
          return undefined
        return {
          recordId: 'record-test',
          applicationProgress: options.progress ?? '待处理',
          checkedAt: 1,
        }
      },
      validateFeishuConfig() {
        if (options.invalidStorage) throw new Error('请配置飞书')
      },
      async upsertJobToFeishu(...args: any[]) {
        counts.storage++
        if (options.failStorageOnce && counts.storage === 1) throw new Error('飞书暂时不可用')
        stored.push(args)
        return {
          recordId: 'record-test',
          applicationProgress: options.progress ?? '待处理',
          checkedAt: 1,
        }
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
        aiFiltering: { enable: options.aiEnabled !== false },
      },
    },
    onJobCardClick: async (key: string) => {
      counts.detail++
      if (options.failDetail) throw new Error('BOSS 需要人工验证')
      helper.jobList.value.find((job: any) => job.key === key).jobDescription = '完整测试 JD'
    },
    loadMoreJob: async () => false,
    notification: async () => {},
  }
  const rawMap = new Map([[job.key, raw]])
  return {
    counts,
    stored,
    lookups,
    helper,
    rawMap,
    async collection(skipExisting = true) {
      helper.workflow = await entry.bossWorkflow(helper, skipExisting)
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

void test('disabled AI collects and stores without model or resume, discarding stale analysis', async () => {
  const fixture = setup({ aiEnabled: false })
  const workflow = await fixture.collection()
  fixture.helper.jobMaps.set('job-test', {
    jobData: fixture.helper.jobList.value[0],
    rawData: fixture.rawMap.get('job-test'),
    state: { aiMatchResult: { decision: 'APPLY', reason: '旧分析' } },
  })
  await workflow.executeAll(fixture.rawMap)
  assert.deepEqual(fixture.counts, { detail: 1, analysis: 0, storage: 1, send: 0, filters: 0 })
  assert.equal(fixture.state().aiMatchResult, undefined)
  assert.equal(fixture.state().stages.analysis.status, 'skipped')
  assert.equal(fixture.state().stages.storage.status, 'succeeded')
  assert.equal(fixture.stored[0][2], undefined)
  assert.equal(fixture.stored[0][0].jobDescription, '完整测试 JD')
})

for (const failure of ['invalidAi', 'invalidStorage', 'invalidSchema'] as const) {
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

for (const options of [
  { progress: '已投递' },
  { progress: '面试中' },
  { progress: '' },
  { missingRecord: true },
  { failRead: true },
]) {
  void test(`Feishu baseline prevents sending: ${JSON.stringify(options)}`, async () => {
    const fixture = setup(options)
    const state = readyToDeliver()
    const workflow = await fixture.delivery(state)
    await workflow.executeAll(fixture.rawMap)
    assert.equal(fixture.counts.send, 0)
    assert.notEqual(fixture.state().stages.delivery?.status, 'succeeded')
    assert.equal(fixture.helper.statistics.todayData.value.success, 0)
  })
}

void test('explicit delivery reads current Feishu progress, not the cached collection snapshot', async () => {
  const fixture = setup({ progress: '面试中' })
  const state = {
    ...readyToDeliver(),
    feishuRecord: { recordId: 'record-test', applicationProgress: '待处理', checkedAt: 0 },
  }
  const workflow = await fixture.delivery(state)
  await workflow.executeAll(fixture.rawMap)
  assert.equal(fixture.state().feishuRecord.applicationProgress, '面试中')
  assert.equal(fixture.counts.send, 0)
})

void test('pagination processes new jobs once and retains repeated jobs across pages without sending', async () => {
  const fixture = setup()
  const first = fixture.helper.jobList.value[0]
  const second = { ...first, key: 'job-second', jobName: '第二个岗位', jobDescription: '' }
  fixture.rawMap.set(second.key, {
    ...fixture.rawMap.get(first.key)!,
    jobitem: { ...fixture.rawMap.get(first.key)!.jobitem, encryptJobId: second.key },
  })
  let page = 1
  fixture.helper.onJobCardClick = async (key: string) => {
    fixture.counts.detail++
    fixture.helper.jobList.value.find((job: any) => job.key === key).jobDescription = '完整分页 JD'
  }
  fixture.helper.loadMoreJob = async () => {
    if (page++ !== 1) return false
    fixture.helper.jobList.value = [first, second]
    return true
  }
  const workflow = await fixture.collection()
  await workflow.executeAll(fixture.rawMap)
  assert.deepEqual(fixture.counts, { detail: 2, analysis: 2, storage: 2, send: 0, filters: 0 })
  assert.equal(fixture.helper.jobMaps.size, 2)
  assert.equal(fixture.stored.length, 2)
})

for (const aiEnabled of [false, true]) {
  void test(`existing Feishu row skips detail, AI and writes with AI=${aiEnabled}`, async () => {
    const fixture = setup({ aiEnabled, existingRecord: true })
    const workflow = await fixture.collection()
    await workflow.executeAll(fixture.rawMap)
    assert.deepEqual(fixture.lookups, ['job-test'])
    assert.deepEqual(fixture.counts, { detail: 0, analysis: 0, storage: 0, send: 0, filters: 0 })
    assert.equal(fixture.state().skippedExisting, true)
    assert.equal(fixture.state().feishuRecordId, 'record-test')
    assert.equal(fixture.state().stages.detail.status, 'skipped')
    assert.equal(fixture.state().stages.storage.status, 'skipped')
    assert.equal(fixture.result().status, 'warn')
    assert.equal(fixture.result().msg, '飞书已有，已跳过')
    await workflow.executeAll(fixture.rawMap)
    assert.equal(fixture.lookups.length, 1)
  })
}

void test('explicit update of a skipped existing row performs detail and writes with AI fields empty', async () => {
  const fixture = setup({ aiEnabled: false, existingRecord: true })
  const batch = await fixture.collection()
  await batch.executeAll(fixture.rawMap)
  const data = fixture.helper.jobMaps.get('job-test')
  const explicit = await fixture.collection(false)
  assert.equal(await explicit.rebuild(), true)
  explicit.status.value = 'running'
  await explicit.execute(data)
  assert.equal(fixture.lookups.length, 1)
  assert.deepEqual(fixture.counts, { detail: 1, analysis: 0, storage: 1, send: 0, filters: 0 })
  assert.equal(fixture.state().skippedExisting, undefined)
  assert.equal(fixture.stored[0][2], undefined)
  assert.equal(fixture.state().stages.detail.status, 'succeeded')
  assert.equal(fixture.result().status, 'success')
})

function addJobs(fixture: ReturnType<typeof setup>, total: number) {
  const first = fixture.rawMap.get('job-test')!
  for (let index = 1; index < total; index++) {
    const key = `job-${index}`
    fixture.helper.jobList.value.push({ key, jobName: '测试岗位', jobDescription: '' })
    fixture.rawMap.set(key, { ...first, jobitem: { ...first.jobitem, encryptJobId: key } })
  }
}

void test('batch pauses before detail 21 across pages and resumes remaining jobs', async () => {
  const fixture = setup({ aiEnabled: false })
  addJobs(fixture, 25)
  const all = fixture.helper.jobList.value.slice()
  fixture.helper.jobList.value = all.slice(0, 15)
  let page = 0
  fixture.helper.loadMoreJob = async () => {
    if (page++) return false
    fixture.helper.jobList.value = all.slice(15)
    return true
  }
  const workflow = await fixture.collection()
  await workflow.executeAll(fixture.rawMap)
  assert.equal(fixture.counts.detail, 20)
  assert.equal(fixture.counts.storage, 20)
  assert.equal(workflow.status.value, 'stop')
  assert.match(workflow.errorMessage.value, /20.*暂停/)
  assert.equal(fixture.helper.jobResultMaps.get('job-20').status, 'wait')
  assert.equal(fixture.helper.jobMaps.get('job-20').state.stages, undefined)
  await workflow.executeAll(fixture.rawMap)
  assert.equal(fixture.counts.detail, 25)
  assert.equal(fixture.counts.storage, 25)
  assert.equal(workflow.errorMessage.value, null)
})

void test('existing rows do not consume the detail batch quota', async () => {
  const fixture = setup({ aiEnabled: false, existingRecord: true })
  addJobs(fixture, 35)
  const workflow = await fixture.collection()
  await workflow.executeAll(fixture.rawMap)
  assert.equal(fixture.lookups.length, 35)
  assert.equal(fixture.counts.detail, 0)
  assert.equal(fixture.counts.storage, 0)
  assert.equal(workflow.errorMessage.value, null)
})

for (const failure of ['failRead', 'failDetail'] as const) {
  void test(`${failure} pauses the batch without contacting later jobs or marking them complete`, async () => {
    const fixture = setup({ [failure]: true, aiEnabled: false })
    addJobs(fixture, 3)
    const workflow = await fixture.collection()
    await workflow.executeAll(fixture.rawMap)
    assert.equal(workflow.status.value, 'stop')
    assert.match(workflow.errorMessage.value, /暂停/)
    assert.equal(fixture.lookups.length, 1)
    assert.equal(fixture.counts.detail, failure === 'failDetail' ? 1 : 0)
    assert.equal(fixture.counts.storage, 0)
    assert.equal(fixture.helper.jobResultMaps.get('job-1').status, 'wait')
    assert.equal(fixture.result().status, 'error')
  })
}
