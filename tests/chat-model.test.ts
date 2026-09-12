import assert from 'node:assert/strict'
import test from 'node:test'

import { ChatModel } from '../src/composables/useModel/chatModel.ts'

void test('reinitializing the same model uses edited URL, API key and model', async (t) => {
  const requests: { url: string; authorization: string | null; model: string }[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(typeof init?.body, 'string')
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      authorization: new Headers(init?.headers).get('authorization'),
      model: JSON.parse(init?.body as string).model,
    })
    return Response.json({
      id: 'test-response',
      object: 'chat.completion',
      created: 0,
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  })
  const conf = {
    key: 'same-key',
    name: 'Test provider',
    data: {
      mode: 'openai' as const,
      base_url: 'https://first.invalid/v1',
      api_key: 'fake-key-first',
      model: 'first-model',
    },
  }
  const ctx = { models: { modelData: { value: [conf] } } }
  const chat = new ChatModel(ctx as ConstructorParameters<typeof ChatModel>[0])
  const selection = { model: conf.key, prompt: 'test', enable: true }
  assert.equal(chat.createAgent(selection, 'filtering'), true)
  await chat.agents.get('filtering')![0].generate({ prompt: 'test' })

  // Edit in place, retaining the configuration key (the stale-cache regression).
  Object.assign(conf.data, {
    base_url: 'https://second.invalid/v1',
    api_key: 'fake-key-second',
    model: 'second-model',
  })
  assert.equal(chat.createAgent(selection, 'filtering'), true)
  await chat.agents.get('filtering')![0].generate({ prompt: 'test' })
  assert.deepEqual(requests, [
    {
      url: 'https://first.invalid/v1/chat/completions',
      authorization: 'Bearer fake-key-first',
      model: 'first-model',
    },
    {
      url: 'https://second.invalid/v1/chat/completions',
      authorization: 'Bearer fake-key-second',
      model: 'second-model',
    },
  ])
})
