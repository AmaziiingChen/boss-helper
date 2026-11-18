import assert from 'node:assert/strict'
import test from 'node:test'

import { candidateContext, readCandidateProfile } from '../src/services/candidateProfile.ts'
import {
  legacyMatchingPrompt,
  matchingPrompt,
  upgradeMatchingPrompt,
} from '../src/services/jobMatching.ts'

void test('local profile import validates version, keys and content, preserving Unicode', () => {
  const profile = {
    schemaVersion: 1,
    updatedAt: '2026-10-05',
    content: ' 深圳优先；2027 届；仿真与业务交付 ',
  }
  assert.equal(readCandidateProfile(JSON.stringify(profile)), profile.content.trim())
  for (const invalid of [
    null,
    {},
    { ...profile, schemaVersion: 2 },
    { ...profile, content: '' },
    { ...profile, content: 'x'.repeat(60001) },
    { ...profile, apiKey: 'secret' },
  ]) {
    assert.throws(() => readCandidateProfile(JSON.stringify(invalid)), /格式无效/)
  }
  assert.match(candidateContext(profile.content, '2026-10-05'), /2026-10-05/)
  assert.match(candidateContext(''), /未导入/)
})

void test('matching defaults upgrade only the recognizable old default, retaining custom prompts', () => {
  const legacy = legacyMatchingPrompt
  assert.deepEqual(upgradeMatchingPrompt(legacy), matchingPrompt)
  assert.deepEqual(
    upgradeMatchingPrompt(legacy.map((item) => ({ content: item.content, role: item.role }))),
    matchingPrompt,
  )
  const custom: any = [{ role: 'system', content: '我的匹配规则' }, legacy[1]]
  assert.equal(upgradeMatchingPrompt(custom), custom)
  const edited = legacy.map((item) => ({ ...item }))
  edited[0]!.content += '\n我的补充条件'
  assert.equal(upgradeMatchingPrompt(edited), edited)
})
