import assert from 'node:assert/strict'
import test from 'node:test'

import {
  runStage,
  stageKeys,
  stageStatuses,
  summarizeCollection,
} from '../src/services/collectionStages.ts'
import type { CollectionState } from '../src/services/collectionStages.ts'

void test('successful stages are reused without repeating actions or incrementing attempts', async () => {
  const state: CollectionState = {}
  let actions = 0
  let observedRunning = false
  assert.equal(
    await runStage(state, 'detail', () => actions++, {
      onRunning() {
        observedRunning = state.stages?.detail?.status === 'running'
      },
    }),
    true,
  )
  assert.equal(observedRunning, true)
  const saved = { ...state.stages!.detail }
  assert.equal(await runStage(state, 'detail', () => actions++), true)
  assert.equal(actions, 1)
  assert.deepEqual(state.stages!.detail, saved)
  assert.equal(saved.status, 'succeeded')
  assert.equal(saved.attempts, 1)
  assert.ok(saved.startedAt! <= saved.finishedAt!)
})

void test('failures preserve the error and retry cleanly without replaying successful stages', async () => {
  const state: CollectionState = {}
  const error = new Error('model unavailable')
  await runStage(state, 'detail', () => undefined)
  await assert.rejects(
    runStage(state, 'analysis', () => {
      throw error
    }),
    (caught) => caught === error,
  )
  assert.equal(state.stages!.analysis!.status, 'failed')
  assert.equal(state.stages!.analysis!.message, error.message)
  assert.equal(state.stages!.analysis!.attempts, 1)
  assert.ok(state.stages!.analysis!.finishedAt)
  await runStage(state, 'detail', () => assert.fail('already collected'))
  await runStage(state, 'analysis', () => undefined)
  assert.equal(state.stages!.analysis!.status, 'succeeded')
  assert.equal(state.stages!.analysis!.attempts, 2)
  assert.equal(state.stages!.analysis!.message, undefined)
  assert.equal(state.stages!.detail!.attempts, 1)
})

void test('disabled stages skip without executing and may run after being enabled', async () => {
  const state: CollectionState = {}
  assert.equal(
    await runStage(state, 'delivery', () => assert.fail('disabled'), { enabled: false }),
    true,
  )
  assert.equal(state.stages!.delivery!.status, 'skipped')
  assert.equal(state.stages!.delivery!.attempts, 0)
  await runStage(state, 'delivery', () => undefined)
  assert.equal(state.stages!.delivery!.status, 'succeeded')
  assert.equal(state.stages!.delivery!.attempts, 1)
})

void test('stopped pipelines do not execute or mutate stage state', async () => {
  const state: CollectionState = {}
  assert.equal(
    await runStage(state, 'detail', () => assert.fail('stopped'), { isStopped: () => true }),
    false,
  )
  assert.deepEqual(state, {})
})

void test('running or uncertain actions cannot be automatically duplicated', async () => {
  for (const status of ['running', 'unknown'] as const) {
    const state: CollectionState = { stages: { delivery: { status, attempts: 1 } } }
    assert.equal(await runStage(state, 'delivery', () => assert.fail('duplicate')), false)
    assert.deepEqual(state.stages!.delivery, { status, attempts: 1 })
  }
})

void test('a pause during the running callback prevents the action and does not consume an attempt', async () => {
  const state: CollectionState = { stages: { storage: { status: 'failed', attempts: 1 } } }
  let stopped = false
  assert.equal(
    await runStage(state, 'storage', () => assert.fail('paused before write'), {
      isStopped: () => stopped,
      onRunning: async () => {
        stopped = true
      },
    }),
    false,
  )
  assert.deepEqual(state.stages!.storage, { status: 'failed', attempts: 1 })
})

void test('summary counts every stage and status, treating absent stages as pending', () => {
  const states: CollectionState[] = [
    {},
    {
      stages: {
        detail: { status: 'succeeded', attempts: 1 },
        analysis: { status: 'failed', attempts: 2 },
      },
    },
    {
      stages: {
        detail: { status: 'running', attempts: 1 },
        storage: { status: 'skipped', attempts: 0 },
        delivery: { status: 'unknown', attempts: 1 },
      },
    },
  ]
  const summary = summarizeCollection(states)
  assert.equal(summary.total, 3)
  assert.equal(summary.stages.detail.pending, 1)
  assert.equal(summary.stages.detail.running, 1)
  assert.equal(summary.stages.detail.succeeded, 1)
  assert.equal(summary.stages.analysis.failed, 1)
  assert.equal(summary.stages.storage.skipped, 1)
  assert.equal(summary.stages.delivery.unknown, 1)
  for (const key of stageKeys) {
    assert.deepEqual(Object.keys(summary.stages[key]), [...stageStatuses])
    assert.equal(
      Object.values(summary.stages[key]).reduce((sum, count) => sum + count, 0),
      3,
    )
  }
  const empty = summarizeCollection([])
  assert.equal(empty.total, 0)
  for (const key of stageKeys)
    for (const status of stageStatuses) assert.equal(empty.stages[key][status], 0)
})
