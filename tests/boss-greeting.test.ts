import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

import * as greeting from '../src/services/greeting.ts'
import * as greetingSend from '../src/services/greetingSend.ts'
import type { GreetingSendRecord, GreetingSendRequest } from '../src/services/greetingSend.ts'
import { shouldDeliverJob } from '../src/services/jobMatching.ts'

const source = readFileSync(
  new URL('../src/entrypoints/boss/greetingSend.ts', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const request: GreetingSendRequest = {
  text: '您好，我有相关项目实践，希望进一步交流。',
  jobName: '测试岗位',
  company: '测试公司',
  recruiter: '测试招聘人',
  confirmed: true,
  defaultGreetingDisabled: true,
}

function setup(
  options: {
    noLocks?: boolean
    locked?: boolean
    missingLogin?: string
    prepareError?: boolean
    recipientError?: boolean
    establishError?: boolean
    sendError?: boolean
    peerPatch?: Record<string, unknown>
    existing?: boolean
  } = {},
) {
  const calls = {
    fetch: [] as Array<{ url: string; init?: RequestInit }>,
    establish: [] as any[][],
    send: [] as any[],
  }
  const logs: unknown[][] = []
  const writes: Array<{ key: string; record: GreetingSendRecord }> = []
  const changed: GreetingSendRecord[] = []
  const locks: Array<{ key: string; options: unknown }> = []
  let saved: GreetingSendRecord | undefined
  const job = {
    encryptBossId: 'encrypted-recruiter',
    encryptJobId: 'encrypted-job',
    securityId: 'fake-security',
    contact: options.existing === true,
  }
  const page: Record<string, unknown> = {
    encryptUserId: 'encrypted-applicant',
    uid: 101,
    token: 'secret-session-token',
  }
  if (options.missingLogin) delete page[options.missingLogin]
  const peer = {
    encryptBossId: job.encryptBossId,
    encryptJobId: job.encryptJobId,
    bossId: 202,
    bossSource: 1,
    ...options.peerPatch,
  }
  const exports: any = {}
  runInNewContext(compiled, {
    exports,
    require(name: string) {
      if (name === '@/services/greeting') return greeting
      if (name === '@/services/greetingSend') return greetingSend
      if (name === '@/message')
        return {
          counter: {
            storageGet: async () => saved,
            storageSet: async (key: string, record: GreetingSendRecord) => {
              saved = { ...record }
              writes.push({ key, record: { ...record } })
              return true
            },
          },
        }
      if (name === './requests')
        return {
          sendPublishReq: async (...args: any[]) => {
            calls.establish.push(args)
            if (options.establishError) throw new Error('secret-session-token secret-bst')
          },
        }
      if (name === './chat')
        return {
          sendBossText: async (input: unknown) => {
            calls.send.push(input)
            if (options.sendError) throw new Error('secret-session-token secret-wt')
            return { serverMid: 'server-ack-1' }
          },
        }
      throw new Error(`Unexpected dependency: ${name}`)
    },
    window: {
      _PAGE: page,
      Cookie: { get: () => (options.missingLogin === 'bst' ? '' : 'secret-bst') },
    },
    navigator: {
      locks: options.noLocks
        ? undefined
        : {
            request: async (
              key: string,
              lockOptions: unknown,
              callback: (lock: unknown) => unknown,
            ) => {
              locks.push({ key, options: lockOptions })
              return callback(options.locked ? null : { name: key })
            },
          },
    },
    fetch: async (url: string, init?: RequestInit) => {
      calls.fetch.push({ url, init })
      if (url.endsWith('/get/wt')) {
        if (options.prepareError) throw new Error('secret-session-token secret-wt')
        return { json: async () => ({ code: 0, zpData: { wt2: 'secret-wt' } }) }
      }
      if (url.endsWith('/getBossData')) {
        if (options.recipientError) throw new Error('secret-session-token secret-bst')
        return { json: async () => ({ code: 0, zpData: { data: peer } }) }
      }
      throw new Error('Unexpected URL')
    },
    FormData,
    AbortSignal,
    console: {
      log: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
      error: (...args: unknown[]) => logs.push(args),
    },
  })
  const display = {
    jobName: request.jobName,
    positionName: request.jobName,
    brand: { name: request.company },
    boss: { name: request.recruiter },
  }
  return {
    calls,
    logs,
    writes,
    changed,
    locks,
    job,
    page,
    peer,
    validate: exports.validateGreetingRecipient,
    run: (patch: Partial<GreetingSendRequest> = {}) =>
      exports.sendGreetingForJob(
        job,
        display,
        { ...request, ...patch },
        (record: GreetingSendRecord) => changed.push(record),
      ),
  }
}

void test('the recipient must match both encrypted recruiter and job IDs and valid numeric IDs', () => {
  const fixture = setup()
  assert.deepEqual(
    { ...fixture.validate({ code: 0, zpData: { data: fixture.peer } }, fixture.job) },
    { recipientId: '202', source: 1 },
  )
  for (const patch of [
    { encryptBossId: 'another-recruiter' },
    { encryptJobId: 'another-job' },
    { bossId: 0 },
    { bossId: Number.MAX_SAFE_INTEGER + 1 },
    { bossId: '202' },
    { bossSource: -1 },
    { bossSource: 0.5 },
  ])
    assert.throws(
      () =>
        fixture.validate({ code: 0, zpData: { data: { ...fixture.peer, ...patch } } }, fixture.job),
      /未能匹配/,
    )
  for (const response of [undefined, { code: 1 }, { code: 0, zpData: {} }]) {
    assert.throws(() => fixture.validate(response, fixture.job), /未能匹配/)
  }
})

void test('send resolves recruiter numeric ID instead of applicant ID, sends exact text once, and blocks replay', async () => {
  const fixture = setup()
  const record = await fixture.run()
  assert.equal(record.status, 'sent')
  assert.equal(fixture.calls.establish.length, 1)
  assert.equal(fixture.calls.establish[0]![2], 1)
  assert.equal(fixture.calls.send.length, 1)
  const input = fixture.calls.send[0]
  assert.equal(input.userId, 101)
  assert.equal(input.recipientId, '202')
  assert.notEqual(String(input.userId), input.recipientId)
  assert.equal(input.source, 1)
  assert.equal(input.text, request.text)
  assert.equal(input.clientMid, record.clientMid)
  assert.equal(record.serverMid, 'server-ack-1')
  assert.equal(fixture.calls.fetch.length, 2)
  const recipientRequest = fixture.calls.fetch.find((call) => call.url.endsWith('/getBossData'))!
  assert.equal(recipientRequest.init!.method, 'POST')
  assert.equal((recipientRequest.init!.body as FormData).get('bossId'), fixture.job.encryptBossId)
  assert.equal((recipientRequest.init!.body as FormData).get('securityId'), fixture.job.securityId)
  await assert.rejects(fixture.run(), /不重复发送/)
  assert.equal(fixture.calls.establish.length, 1)
  assert.equal(fixture.calls.send.length, 1)
  assert.equal(fixture.calls.fetch.length, 2)
  assert.deepEqual({ ...fixture.locks[0]!.options! }, { ifAvailable: true })
})

for (const options of [{ noLocks: true }, { locked: true }]) {
  void test(`unavailable or occupied lock prevents every network mutation: ${JSON.stringify(options)}`, async () => {
    const fixture = setup(options)
    await assert.rejects(fixture.run(), /锁|另一页面/)
    assert.equal(fixture.calls.fetch.length, 0)
    assert.equal(fixture.calls.establish.length, 0)
    assert.equal(fixture.calls.send.length, 0)
    assert.equal(fixture.writes.length, 0)
  })
}

void test('changed metadata and missing login data fail before network requests', async () => {
  for (const field of ['jobName', 'company', 'recruiter'] as const) {
    const fixture = setup()
    await assert.rejects(fixture.run({ [field]: 'changed' }), /已变化/)
    assert.equal(fixture.calls.fetch.length, 0)
    assert.equal(fixture.calls.send.length, 0)
  }
  for (const missingLogin of ['encryptUserId', 'uid', 'token']) {
    const fixture = setup({ missingLogin })
    await assert.rejects(fixture.run(), /数据不完整/)
    assert.equal(fixture.calls.fetch.length, 0)
    assert.equal(fixture.calls.send.length, 0)
  }
})

for (const options of [{ prepareError: true }, { missingLogin: 'bst' }]) {
  void test(`preparation failure never creates a relationship or sends text: ${JSON.stringify(options)}`, async () => {
    const fixture = setup(options)
    assert.equal((await fixture.run()).status, 'failed')
    assert.equal(fixture.calls.establish.length, 0)
    assert.equal(fixture.calls.send.length, 0)
  })
}

for (const options of [
  { recipientError: true },
  { peerPatch: { encryptBossId: 'other-peer' } },
  { peerPatch: { encryptJobId: 'other-job' } },
  { peerPatch: { bossId: 101 } },
]) {
  void test(`recipient lookup or validation failure never sends text: ${JSON.stringify(options)}`, async () => {
    const fixture = setup(options)
    const record = await fixture.run()
    assert.notEqual(record.status, 'sent')
    assert.equal(fixture.calls.send.length, 0)
    assert.ok(fixture.calls.establish.length <= 1)
  })
}

for (const options of [{ establishError: true }, { sendError: true }]) {
  void test(`uncertain mutation is tried once, blocked on replay, and never leaks credentials: ${JSON.stringify(options)}`, async () => {
    const fixture = setup(options)
    assert.equal((await fixture.run()).status, 'unknown')
    const calls = {
      establish: fixture.calls.establish.length,
      send: fixture.calls.send.length,
      fetch: fixture.calls.fetch.length,
    }
    await assert.rejects(fixture.run(), /待核实/)
    assert.equal(fixture.calls.establish.length, calls.establish)
    assert.equal(fixture.calls.send.length, calls.send)
    assert.equal(fixture.calls.fetch.length, calls.fetch)
    assert.ok(calls.establish <= 1)
    assert.ok(calls.send <= 1)
    const visible = JSON.stringify({
      logs: fixture.logs,
      changed: fixture.changed,
      writes: fixture.writes,
    })
    for (const secret of ['secret-session-token', 'secret-bst', 'secret-wt', 'fake-security'])
      assert.equal(visible.includes(secret), false)
  })
}

void test('an existing relationship does not establish another one', async () => {
  const fixture = setup({ existing: true })
  assert.equal((await fixture.run()).status, 'sent')
  assert.equal(fixture.calls.establish.length, 0)
  assert.equal(fixture.calls.send.length, 1)
})

// Extract the production method AST to test its entry gate without initializing the BOSS page.
const helperSource = ts.createSourceFile(
  'boss.ts',
  readFileSync(new URL('../src/entrypoints/boss/index.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
)
const helperClass = helperSource.statements.find(
  (statement): statement is ts.ClassDeclaration =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'BossHelperCtx',
)!
const greetingMethod = helperClass.members.find(
  (member): member is ts.MethodDeclaration =>
    ts.isMethodDeclaration(member) && member.name.getText(helperSource) === 'sendGreeting',
)!
const gateScript = ts.transpileModule(
  `exports.gate = class { ${greetingMethod.getText(helperSource)} }.prototype.sendGreeting`,
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText

void test('BossHelperCtx greeting gate retains AI eligibility and fresh Feishu pending status checks', async () => {
  for (const scenario of [
    { decision: 'REJECT', progress: '待处理', sends: 0 },
    { decision: 'REVIEW', progress: '待处理', sends: 0 },
    { decision: 'APPLY', progress: '面试中', sends: 0 },
    { decision: 'APPLY', progress: '', sends: 0 },
    { decision: 'APPLY', progress: '待处理', sends: 1 },
  ]) {
    let sends = 0
    let reads = 0
    const exported: any = {}
    runInNewContext(gateScript, {
      exports: exported,
      shouldDeliverJob,
      readJobFromFeishu: async () => {
        reads++
        return { applicationProgress: scenario.progress }
      },
      sendGreetingForJob: async () => {
        sends++
      },
    })
    const state = {
      aiMatchResult: { decision: scenario.decision },
      feishuRecord: { applicationProgress: '待处理' },
    }
    const helper = {
      models: { initModel: async () => undefined },
      prepareCollectionInputs: async () => undefined,
      starting: false,
      workflowRunning: { value: false },
      actionRunning: { value: false },
      jobMaps: new Map([
        [
          'key',
          {
            jobData: { jobDescription: '完整 JD' },
            rawData: { jobitem: { encryptJobId: 'encrypted-job' } },
            state,
          },
        ],
      ]),
      conf: {
        confInit: async () => undefined,
        formData: { deliverReview: { value: false }, feishu: { enable: true } },
      },
    }
    if (scenario.sends) await exported.gate.call(helper, 'key', request)
    else await assert.rejects(exported.gate.call(helper, 'key', request), /AI|待处理/)
    assert.equal(sends, scenario.sends)
    assert.equal(helper.actionRunning.value, false)
    assert.equal(reads, scenario.decision === 'APPLY' ? 1 : 0)
    if (reads) assert.equal(state.feishuRecord.applicationProgress, scenario.progress)
  }
})
