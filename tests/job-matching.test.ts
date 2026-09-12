import assert from 'node:assert/strict'
import test from 'node:test'

import { parseJobMatchResult, shouldDeliverJob } from '../src/services/jobMatching.ts'

const valid = {
  decision: 'APPLY',
  reason: '经历与岗位要求匹配',
  matchPoints: ['项目经验'],
  gaps: [],
  uncertainties: [],
}

void test('AI decision parser only accepts the strict contract', () => {
  assert.deepEqual(parseJobMatchResult(JSON.stringify(valid)), valid)
  assert.deepEqual(parseJobMatchResult(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``), valid)
  assert.throws(() => parseJobMatchResult('{"decision":"APPLY"}'), /字段错误/)
  assert.throws(() => parseJobMatchResult(JSON.stringify({ ...valid, extra: true })), /字段错误/)
  assert.throws(
    () => parseJobMatchResult(JSON.stringify({ ...valid, decision: 'SEND' })),
    /决策错误/,
  )
  assert.throws(() => parseJobMatchResult(JSON.stringify({ ...valid, gaps: [''] })), /gaps/)
})

void test('delivery permission is fail-closed for REJECT and REVIEW', () => {
  assert.equal(shouldDeliverJob('REJECT', false, false), false)
  assert.equal(shouldDeliverJob('REJECT', true, true), false)
  assert.equal(shouldDeliverJob('REVIEW', false, true), false)
  assert.equal(shouldDeliverJob('REVIEW', true, false), false)
  assert.equal(shouldDeliverJob('REVIEW', true, true), true)
  assert.equal(shouldDeliverJob('APPLY', false, true), false)
  assert.equal(shouldDeliverJob('APPLY', true, false), true)
})
