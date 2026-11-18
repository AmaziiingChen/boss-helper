import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import protobuf from 'protobufjs'

import { BossTextSendError, sendBossText } from '../src/entrypoints/boss/chat/index.ts'
import type { ChatTransportDependencies } from '../src/entrypoints/boss/chat/index.ts'

// Independent minimal wire fixture: use actual Protobuf bytes, not mocked decoding.
const protocol = protobuf
  .parse(`
  message User { required int64 uid = 1; optional int32 source = 7; }
  message Body { required int32 type = 1; required int32 templateId = 2; optional string text = 3; }
  message Message { required User from = 1; required User to = 2; required int32 type = 3; optional int64 mid = 4; optional int64 time = 5; required Body body = 6; optional int64 cmid = 11; }
  message Sync { required int64 clientMid = 1; required int64 serverMid = 2; }
  message Protocol { required int32 type = 1; repeated Message messages = 3; repeated Sync messageSync = 7; }
`)
  .root.lookupType('Protocol')
const input = {
  userId: '9007199254741001',
  recipientId: '9007199254741002',
  source: 1,
  token: 'fake-session-token',
  wt: 'fake-wt',
  text: '测试文字',
  clientMid: '9007199254741003',
}
function ack(clientMid = input.clientMid, serverMid = '9007199254741004', type = 5) {
  return protocol
    .encode(protocol.fromObject({ type, messageSync: [{ clientMid, serverMid }] }))
    .finish()
}

class FakeClient extends EventEmitter {
  sent: Array<{ topic: string; payload: Uint8Array; options: unknown }> = []
  ended = 0
  publishError: Error | undefined
  publish(topic: string, payload: Uint8Array, options: unknown, callback: (error?: Error) => void) {
    this.sent.push({ topic, payload, options })
    callback(this.publishError)
  }
  end(force: boolean) {
    assert.equal(force, true)
    this.ended++
  }
}
function fixture() {
  const client = new FakeClient()
  const calls: Array<{
    url: string
    options: Parameters<ChatTransportDependencies['connect']>[1]
  }> = []
  const dependencies: ChatTransportDependencies = {
    timeoutMs: 25,
    connect: (url, options) => {
      calls.push({ url, options })
      return client
    },
  }
  return { client, calls, dependencies }
}

void test('only a matching type-5 business ACK resolves, with exact int64 IDs and one non-replayed publish', async () => {
  const { client, calls, dependencies } = fixture()
  const sending = sendBossText(input, dependencies)
  let finished = false
  void sending.then(() => {
    finished = true
  })
  client.emit('message', 'chat', ack()) // A stale ACK before publishing cannot succeed.
  client.emit('connect')
  client.emit('connect')
  await Promise.resolve()
  assert.equal(finished, false) // publish callback alone is insufficient.
  assert.equal(client.sent.length, 1)
  assert.deepEqual(client.sent[0]!.options, { qos: 0, retain: false })
  const decoded = protocol.toObject(protocol.decode(client.sent[0]!.payload), { longs: String })
  assert.equal(decoded.type, 1)
  assert.equal(decoded.messages[0].from.uid, input.userId)
  assert.equal(decoded.messages[0].to.uid, input.recipientId)
  assert.equal(decoded.messages[0].to.source, input.source)
  assert.equal(decoded.messages[0].mid, input.clientMid)
  assert.equal(decoded.messages[0].cmid, input.clientMid)
  assert.deepEqual(decoded.messages[0].body, { type: 1, templateId: 1, text: input.text })
  client.emit('message', 'chat', ack('999'))
  client.emit('message', 'chat', ack(input.clientMid, '123', 6))
  client.emit('message', 'chat', new Uint8Array([255]))
  client.emit('message', 'chat', ack(input.clientMid, '0'))
  await Promise.resolve()
  assert.equal(finished, false)
  client.emit('message', 'chat', ack())
  assert.deepEqual(await sending, { serverMid: '9007199254741004' })
  assert.equal(client.ended, 1)
  assert.equal(client.listenerCount('message'), 0)
  assert.equal(client.listenerCount('connect'), 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, 'wss://ws6.zhipin.com/chatws')
  assert.equal(calls[0]!.options?.reconnectPeriod, 0)
  assert.equal(calls[0]!.options?.queueQoSZero, false)
  assert.equal(calls[0]!.options?.clean, true)
})

for (const event of ['error', 'close', 'offline', 'disconnect']) {
  void test(`${event} marks the attempt unknown, closes the client and never republishes`, async () => {
    const { client, dependencies } = fixture()
    const sending = sendBossText(input, dependencies)
    const rejected = assert.rejects(sending, (error: unknown) => {
      assert.ok(error instanceof BossTextSendError)
      assert.equal(error.status, 'unknown')
      assert.equal(error.message.includes(input.token), false)
      assert.equal(error.message.includes(input.wt), false)
      return true
    })
    client.emit('connect')
    client.emit(event, new Error(`${input.token} ${input.wt}`))
    await rejected
    client.emit('connect')
    client.emit('message', 'chat', ack())
    assert.equal(client.sent.length, 1)
    assert.equal(client.ended, 1)
  })
}

void test('publish error is unknown and does not expose raw transport errors', async () => {
  const { client, dependencies } = fixture()
  client.publishError = new Error(`${input.token} ${input.wt}`)
  const sending = sendBossText(input, dependencies)
  client.emit('connect')
  await assert.rejects(sending, (error: unknown) => {
    assert.ok(error instanceof BossTextSendError)
    assert.equal(error.status, 'unknown')
    assert.equal(error.message.includes(input.token), false)
    return true
  })
  assert.equal(client.sent.length, 1)
  assert.equal(client.ended, 1)
})

void test('without a valid ACK, timeout is unknown and no resend occurs', async () => {
  const { client, dependencies } = fixture()
  const sending = sendBossText(input, dependencies)
  client.emit('connect')
  client.emit('message', 'chat', ack('999'))
  await assert.rejects(
    sending,
    (error: unknown) => error instanceof BossTextSendError && error.status === 'unknown',
  )
  assert.equal(client.sent.length, 1)
  assert.equal(client.ended, 1)
})

void test('no connection event times out without publishing and disconnects', async () => {
  const { client, dependencies } = fixture()
  await assert.rejects(sendBossText(input, dependencies), BossTextSendError)
  assert.equal(client.sent.length, 0)
  assert.equal(client.ended, 1)
})

void test('invalid or lossy IDs are rejected before connecting', async () => {
  const { calls, dependencies } = fixture()
  for (const recipientId of [
    0,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
    'not-a-number',
    '9223372036854775808',
  ]) {
    await assert.rejects(sendBossText({ ...input, recipientId }, dependencies), /ID/)
  }
  assert.equal(calls.length, 0)
})
