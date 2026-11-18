import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectionLabel,
  collectionProgress,
  deliveryBlockReason,
  failedCollectionStages,
  safeStageMessage,
  stageView,
} from '../src/utils/collectionView.ts'
import type { CollectionViewState } from '../src/utils/collectionView.ts'

const completed = (decision: 'APPLY' | 'REVIEW' | 'REJECT' = 'APPLY'): CollectionViewState => ({
  stages: {
    detail: { status: 'succeeded', attempts: 1 },
    analysis: { status: 'succeeded', attempts: 1 },
    storage: { status: 'succeeded', attempts: 1 },
  },
  aiMatchResult: { decision },
  delivered: false,
})

test('REJECT is a valid completed analysis, not a pipeline failure or delivery', () => {
  const state = completed('REJECT')
  assert.equal(collectionLabel(state), '采集完成')
  assert.equal(stageView('analysis', state).severity, 'success')
  assert.equal(stageView('storage', state).label, '已入库')
  assert.equal(stageView('delivery', state).label, '未投递')
  assert.match(deliveryBlockReason(state, true, false, false), /不建议投递/)
})

test('storage failure keeps prior success and exposes only the failed collection stage', () => {
  const state = completed()
  state.stages!.storage = { status: 'failed', attempts: 2, message: '表格字段缺失' }
  assert.deepEqual(failedCollectionStages(state), ['storage'])
  assert.equal(collectionLabel(state), '入库失败')
  assert.equal(stageView('detail', state).label, '详情已获取')
  assert.equal(stageView('analysis', state).label, '已分析')
  assert.equal(stageView('storage', state).attempts, 2)
  assert.equal(stageView('storage', state).message, '表格字段缺失')
})

test('disabled stages are neutral and missing stages stay pending', () => {
  const state = completed()
  state.stages!.analysis = { status: 'skipped', attempts: 0 }
  state.stages!.storage = { status: 'skipped', attempts: 0 }
  delete state.aiMatchResult
  assert.equal(stageView('analysis', state).label, '未启用')
  assert.equal(stageView('storage', state).severity, 'secondary')
  assert.equal(collectionLabel(state), '采集完成')
  assert.equal(stageView('detail').label, '待处理')
  assert.equal(stageView('delivery').label, '未投递')
  assert.match(deliveryBlockReason(state, true, false, false), /先完成/)
})

test('unknown or running delivery cannot be resent, even with older success evidence', () => {
  for (const status of ['unknown', 'running'] as const) {
    const state = completed()
    state.delivered = true
    state.stages!.delivery = { status, attempts: 1 }
    assert.equal(stageView('delivery', state).status, status)
    assert.notEqual(deliveryBlockReason(state, true, false, false), '')
  }
  const sent = completed()
  sent.delivered = true
  assert.equal(stageView('delivery', sent).label, '已投递')
  assert.match(deliveryBlockReason(sent, true, false, false), /已投递/)
})

test('delivery requires ready stages, permitted decision, idle workflow and remaining quota', () => {
  assert.equal(deliveryBlockReason(completed(), false, false, false), '')
  assert.match(deliveryBlockReason(completed('REVIEW'), false, false, false), /REVIEW/)
  assert.equal(deliveryBlockReason(completed('REVIEW'), true, false, false), '')
  assert.match(deliveryBlockReason(completed(), true, true, false), /暂停/)
  assert.match(deliveryBlockReason(completed(), true, false, true), /上限/)
  assert.match(deliveryBlockReason(undefined, true, false, false), /未找到/)
})

test('diagnostics exclude raw response bodies, credentials and request URLs', () => {
  for (const message of [
    '{"api_key":"sensitive","body":"private"}',
    'request failed Bearer sensitive-access-token',
    'config api_key="sensitive"',
    'config "app_secret":"sensitive"',
    'failure https://example.com/api?key=sensitive',
  ])
    assert.doesNotMatch(safeStageMessage(message), /sensitive|private|example\.com/)
  assert.equal(safeStageMessage('缺少必填字段 Table ID'), '缺少必填字段 Table ID')
  assert.equal(safeStageMessage('x'.repeat(600)).length, 300)
})

test('collection progress only counts fully completed jobs, including deliberately skipped stages', () => {
  assert.deepEqual(collectionProgress([]), { completed: 0, total: 0, value: 0 })
  const skipped = completed()
  skipped.stages!.analysis = { status: 'skipped', attempts: 0 }
  skipped.stages!.storage = { status: 'skipped', attempts: 0 }
  const failed = completed()
  failed.stages!.storage = { status: 'failed', attempts: 1 }
  assert.deepEqual(collectionProgress([completed('REJECT'), skipped, failed, {}]), {
    completed: 2,
    total: 4,
    value: 50,
  })
})

test('discovering another page updates the denominator instead of fabricating complete progress', () => {
  assert.equal(collectionProgress([completed()]).value, 100)
  assert.deepEqual(collectionProgress([completed(), {}]), { completed: 1, total: 2, value: 50 })
})

void test('remote existing rows are shown as skipped rather than fetched or newly stored', () => {
  const state: CollectionViewState = { skippedExisting: true, feishuRecordId: 'record', stages: {} }
  for (const key of ['detail', 'analysis', 'storage'] as const)
    state.stages![key] = { status: 'skipped', attempts: 0 }
  assert.equal(collectionLabel(state), '飞书已有，已跳过')
  assert.equal(stageView('detail', state).label, '已跳过')
  assert.equal(stageView('analysis', state).label, '已跳过')
  assert.equal(stageView('storage', state).label, '飞书已有')
  assert.equal(collectionProgress([state]).value, 100)
})
