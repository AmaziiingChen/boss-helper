import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deliveryEvidenceLabel,
  hasResumeContent,
  isProcessedStatus,
  workbenchStatusLabel,
} from '../src/utils/workbenchState.ts'

test('readiness rejects empty rich text and the default resume placeholder', () => {
  for (const content of [
    '',
    '<p><br></p>',
    '<p>&nbsp; &#160;</p>',
    '<h1>姓名</h1><p>手机号 · 邮箱 · 所在城市</p>',
  ]) {
    assert.equal(hasResumeContent(content), false)
  }
  assert.equal(hasResumeContent('<h1>张晨晨</h1><p>产品实习与项目经历</p>'), true)
  assert.equal(hasResumeContent('# 张晨晨\n项目实践'), true)
})

test('analysis-only completion differs from filtered skips without hiding errors', () => {
  const state = { aiMatchResult: { decision: 'APPLY' }, delivered: false }
  assert.equal(workbenchStatusLabel('warn', state), '已分析，未投递')
  assert.equal(workbenchStatusLabel('success', state), '已分析，未投递')
  assert.equal(workbenchStatusLabel('warn', undefined), '已跳过')
  assert.equal(workbenchStatusLabel('error', state), '处理失败')
  assert.equal(workbenchStatusLabel('running', state), '处理中')
  assert.equal(workbenchStatusLabel('warn', { aiMatchResult: {}, delivered: true }), '已跳过')
})

test('delivery labels require explicit delivery evidence', () => {
  assert.equal(deliveryEvidenceLabel(true), '已投递')
  assert.equal(deliveryEvidenceLabel(false), '未投递')
  assert.equal(deliveryEvidenceLabel(undefined), '尚无投递结果')
})

test('progress counts terminal results, never an in-flight current-job index', () => {
  assert.equal(
    ['success', 'warn', 'error', 'running', 'request', 'ai', 'wait'].filter(isProcessedStatus)
      .length,
    3,
  )
  assert.equal(isProcessedStatus(undefined), false)
})
