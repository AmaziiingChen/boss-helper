import assert from 'node:assert/strict'
import test from 'node:test'

import { effectScope, reactive } from 'vue'

import { useFeishuConnectionCheck } from '../src/composables/useFeishuConnectionCheck.ts'
import type { FeishuConnectionReport, FeishuConnectionStep } from '../src/services/feishu.ts'
import type { FeishuConfig } from '../src/types/formData.ts'

const success: FeishuConnectionReport = {
  success: true,
  checkedAt: 1789171200000,
  readOnly: true,
  writeVerified: false,
  steps: [{ id: 'auth', label: '应用凭据', status: 'success' }],
}

function harness() {
  const config = reactive<FeishuConfig>({
    enable: true,
    appId: 'draft-app-id',
    appSecret: 'draft-secret',
    appToken: 'draft-app-token',
    tableId: 'draft-table-id',
  })
  const calls: Array<{
    input: FeishuConfig
    progress?: (steps: FeishuConnectionStep[]) => void
    resolve: (value: FeishuConnectionReport) => void
    reject: (reason: unknown) => void
  }> = []
  const scope = effectScope()
  const state = scope.run(() =>
    useFeishuConnectionCheck(
      () => config,
      (input, progress) =>
        new Promise<FeishuConnectionReport>((resolve, reject) => {
          calls.push({ input, progress, resolve, reject })
        }),
    ),
  )!
  return { config, calls, state, dispose: () => scope.stop() }
}

void test('connection check snapshots the current draft, coalesces repeated clicks and records success time', async () => {
  const h = harness()
  try {
    h.config.appId = 'edited-before-run'
    const running = h.state.run()
    assert.equal(h.state.testing.value, true)
    await h.state.run()
    assert.equal(h.calls.length, 1)
    const call = h.calls[0]!
    assert.deepEqual(call.input, { ...h.config })
    assert.notEqual(call.input, h.config)
    call.progress?.([{ id: 'auth', label: '应用凭据', status: 'running' }])
    assert.equal(h.state.steps.value[0]!.status, 'running')
    call.resolve(success)
    await running
    assert.equal(h.state.testing.value, false)
    assert.equal(h.state.report.value, success)
    assert.equal(h.state.lastCheckedAt.value, success.checkedAt)
    assert.deepEqual(h.state.steps.value, success.steps)
    assert.equal(h.state.stale.value, false)
  } finally {
    h.dispose()
  }
})

for (const field of ['appId', 'appSecret', 'appToken', 'tableId'] as const) {
  void test(`editing ${field} immediately invalidates an existing connection result`, async () => {
    const h = harness()
    try {
      const running = h.state.run()
      h.calls[0]!.resolve(success)
      await running
      h.config[field] += '-changed'
      assert.equal(h.state.report.value, null)
      assert.deepEqual(h.state.steps.value, [])
      assert.equal(h.state.stale.value, true)
      assert.equal(h.state.error.value, '')
    } finally {
      h.dispose()
    }
  })
}

void test('editing a credential during a request ignores late progress and results until a fresh check', async () => {
  const h = harness()
  try {
    const running = h.state.run()
    const oldCall = h.calls[0]!
    h.config.tableId = 'new-target-table'
    assert.equal(oldCall.input.tableId, 'draft-table-id')
    oldCall.progress?.(success.steps)
    oldCall.resolve(success)
    await running
    assert.equal(h.state.report.value, null)
    assert.deepEqual(h.state.steps.value, [])
    assert.equal(h.state.lastCheckedAt.value, null)
    assert.equal(h.state.stale.value, true)
    assert.equal(h.state.testing.value, false)

    const fresh = h.state.run()
    assert.equal(h.calls[1]!.input.tableId, 'new-target-table')
    h.calls[1]!.resolve({ ...success, checkedAt: success.checkedAt + 1000 })
    await fresh
    assert.equal(h.state.lastCheckedAt.value, success.checkedAt + 1000)
    assert.equal(h.state.stale.value, false)
  } finally {
    h.dispose()
  }
})

void test('disposing prevents late progress results and further checks from updating state', async () => {
  const h = harness()
  const running = h.state.run()
  const before = {
    report: h.state.report.value,
    steps: [...h.state.steps.value],
    testing: h.state.testing.value,
    checkedAt: h.state.lastCheckedAt.value,
    error: h.state.error.value,
  }
  h.dispose()
  h.calls[0]!.progress?.(success.steps)
  h.calls[0]!.resolve(success)
  await running
  await h.state.run()
  assert.deepEqual(
    {
      report: h.state.report.value,
      steps: [...h.state.steps.value],
      testing: h.state.testing.value,
      checkedAt: h.state.lastCheckedAt.value,
      error: h.state.error.value,
    },
    before,
  )
  assert.equal(h.calls.length, 1)
})

void test('disabling sync does not invalidate credential checks in flight or completed', async () => {
  const h = harness()
  try {
    const running = h.state.run()
    h.config.enable = false
    assert.equal(h.state.stale.value, false)
    h.calls[0]!.resolve(success)
    await running
    assert.equal(h.state.report.value, success)
    h.config.enable = true
    h.config.enable = false
    assert.equal(h.state.report.value, success)
    assert.equal(h.state.stale.value, false)
    assert.equal(h.state.lastCheckedAt.value, success.checkedAt)
  } finally {
    h.dispose()
  }
})

void test('unexpected errors display a safe message and credential edits clear it', async () => {
  const h = harness()
  try {
    const running = h.state.run()
    h.calls[0]!.reject(new Error('sensitive-test-detail'))
    await running
    assert.equal(h.state.testing.value, false)
    assert.equal(h.state.report.value, null)
    assert.match(h.state.error.value, /连接检测未能完成/)
    assert.doesNotMatch(h.state.error.value, /sensitive-test-detail/)
    h.config.appSecret = 'replacement-secret'
    assert.equal(h.state.error.value, '')
  } finally {
    h.dispose()
  }
})
