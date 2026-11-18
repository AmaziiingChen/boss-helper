import assert from 'node:assert/strict'
import test from 'node:test'

import { greetingHash } from '../src/services/greeting.ts'
import { executeGreetingSend } from '../src/services/greetingSend.ts'
import type {
  GreetingSendDependencies,
  GreetingSendRecord,
  GreetingSendRequest,
} from '../src/services/greetingSend.ts'

const request: GreetingSendRequest = {
  text: '您好，我有相关项目实践，希望进一步沟通。',
  jobName: '测试岗位',
  company: '测试公司',
  recruiter: '测试招聘人',
  confirmed: true,
  defaultGreetingDisabled: true,
}

function setup(previous?: GreetingSendRecord) {
  let durable = previous
  const events: string[] = []
  const writes: GreetingSendRecord[] = []
  const changes: GreetingSendRecord[] = []
  const deps: GreetingSendDependencies = {
    existing: false,
    read: async () => {
      events.push('read')
      return durable
    },
    write: async (record) => {
      events.push(`write:${record.status}:${record.relationship}`)
      writes.push({ ...record })
      durable = { ...record }
    },
    changed: (record) => {
      changes.push({ ...record })
    },
    prepare: async () => {
      events.push('prepare')
    },
    establish: async () => {
      events.push('establish')
    },
    send: async (clientMid) => {
      events.push(`send:${clientMid}`)
      return { serverMid: 'server-receipt-1' }
    },
  }
  return { deps, events, writes, changes, durable: () => durable }
}

void test('explicit flags and nonempty bounded text are required before touching dependencies', async () => {
  const invalid = [
    { confirmed: false },
    { confirmed: 'true' },
    { defaultGreetingDisabled: false },
    { defaultGreetingDisabled: 1 },
    { text: '' },
    { text: ' \n\t' },
    { text: null },
    { text: '字'.repeat(501) },
  ]
  for (const patch of invalid) {
    const h = setup()
    await assert.rejects(
      executeGreetingSend({ ...request, ...patch } as GreetingSendRequest, h.deps),
    )
    assert.deepEqual(h.events, [])
    assert.deepEqual(h.changes, [])
  }
})

void test('a 500-code-point greeting is accepted and its exact text is hashed', async () => {
  const h = setup()
  const text = '🙂'.repeat(500)
  const record = await executeGreetingSend({ ...request, text }, h.deps)
  assert.equal(record.status, 'sent')
  assert.equal(record.textHash, await greetingHash(text))
})

void test('prepare failure records a retryable failure without establishing or sending', async () => {
  const h = setup()
  h.deps.prepare = async () => {
    h.events.push('prepare')
    throw new Error('not ready')
  }
  const record = await executeGreetingSend(request, h.deps)
  assert.equal(record.status, 'failed')
  assert.equal(record.relationship, 'not_started')
  assert.equal(h.events.includes('establish'), false)
  assert.equal(
    h.events.some((event) => event.startsWith('send:')),
    false,
  )
  assert.equal(h.durable()?.status, 'failed')
})

void test('failure to persist initial intent prevents prepare and all external mutations', async () => {
  const h = setup()
  h.deps.write = async () => {
    throw new Error('storage unavailable')
  }
  const record = await executeGreetingSend(request, h.deps)
  assert.equal(record.status, 'failed')
  assert.deepEqual(h.events, ['read'])
  assert.equal(h.durable(), undefined)
})

void test('durable intent precedes relationship and send operations and business acknowledgement marks sent', async () => {
  const h = setup()
  h.deps.establish = async () => {
    assert.equal(h.durable()?.status, 'preparing')
    assert.equal(h.durable()?.relationship, 'unknown')
    h.events.push('establish')
  }
  h.deps.send = async (clientMid) => {
    assert.equal(h.durable()?.status, 'sending')
    assert.equal(h.durable()?.relationship, 'confirmed')
    assert.equal(h.durable()?.clientMid, clientMid)
    h.events.push('send')
    return { serverMid: 'acknowledged-message' }
  }
  const record = await executeGreetingSend(request, h.deps)
  assert.equal(record.status, 'sent')
  assert.equal(record.serverMid, 'acknowledged-message')
  assert.equal(h.durable()?.status, 'sent')
  assert.deepEqual(h.events, [
    'read',
    'write:preparing:not_started',
    'prepare',
    'write:preparing:unknown',
    'establish',
    'write:preparing:confirmed',
    'write:sending:confirmed',
    'send',
    'write:sent:confirmed',
  ])
})

void test('send timeout becomes unknown and a second invocation cannot automatically retry', async () => {
  const h = setup()
  let attempts = 0
  h.deps.send = async () => {
    attempts++
    throw new Error('timeout')
  }
  const record = await executeGreetingSend(request, h.deps)
  assert.equal(record.status, 'unknown')
  assert.equal(h.durable()?.status, 'unknown')
  await assert.rejects(executeGreetingSend(request, h.deps), /禁止自动重发/)
  assert.equal(attempts, 1)
  assert.equal(h.events.filter((event) => event === 'establish').length, 1)
})

for (const status of ['sent', 'unknown', 'preparing', 'sending'] as const) {
  void test(`existing ${status} record prevents every new external operation`, async () => {
    const previous: GreetingSendRecord = {
      status,
      relationship: 'confirmed',
      textHash: 'old-hash',
      clientMid: 'old-client-id',
      updatedAt: 1,
      message: 'existing record',
    }
    const h = setup(previous)
    await assert.rejects(executeGreetingSend(request, h.deps), /不重复发送|禁止自动重发/)
    assert.deepEqual(h.events, ['read'])
    assert.deepEqual(h.changes, [previous])
  })
}

void test('an existing relationship bypasses establish but still persists sending intent', async () => {
  const h = setup()
  h.deps.existing = true
  const record = await executeGreetingSend(request, h.deps)
  assert.equal(record.status, 'sent')
  assert.equal(record.relationship, 'existing')
  assert.equal(h.events.includes('establish'), false)
  const sendIndex = h.events.findIndex((event) => event.startsWith('send:'))
  assert.ok(h.events.indexOf('write:sending:existing') < sendIndex)
})

void test('storage failure before sending blocks send even after a relationship was established', async () => {
  const h = setup()
  const write = h.deps.write.bind(h.deps)
  h.deps.write = async (record) => {
    if (record.status === 'sending') throw new Error('storage unavailable')
    await write(record)
  }
  const record = await executeGreetingSend(request, h.deps)
  assert.equal(record.status, 'unknown')
  assert.equal(h.events.includes('establish'), true)
  assert.equal(
    h.events.some((event) => event.startsWith('send:')),
    false,
  )
})

void test('missing business receipt is unknown rather than sent', async () => {
  const h = setup()
  h.deps.send = async () => ({ serverMid: '' })
  const record = await executeGreetingSend(request, h.deps)
  assert.equal(record.status, 'unknown')
  assert.equal(
    h.writes.some((value) => value.status === 'sent'),
    false,
  )
})

void test('storage failure after acknowledgement leaves unknown and durable sending intent blocks retry', async () => {
  const h = setup()
  const write = h.deps.write.bind(h.deps)
  h.deps.write = async (record) => {
    if (record.status === 'sent' || record.status === 'unknown')
      throw new Error('storage unavailable')
    await write(record)
  }
  const record = await executeGreetingSend(request, h.deps)
  assert.equal(record.status, 'unknown')
  assert.equal(record.serverMid, 'server-receipt-1')
  assert.equal(h.durable()?.status, 'sending')
  assert.equal(h.changes.at(-1)?.status, 'unknown')
  await assert.rejects(executeGreetingSend(request, h.deps), /禁止自动重发/)
  assert.equal(h.events.filter((event) => event.startsWith('send:')).length, 1)
})
