import assert from 'node:assert/strict'
import test from 'node:test'

import { isDetailForJob } from '../src/entrypoints/boss/detailGuard.ts'
import { bossDetailFixture, bossListFixture } from './fixtures/boss-jobs.ts'

test('a detail fixture cannot be attached to another list job', () => {
  assert.equal(isDetailForJob(bossDetailFixture, bossListFixture[0]), false)
  assert.equal(isDetailForJob(bossDetailFixture, bossListFixture[1]), true)
  assert.equal(isDetailForJob(undefined, bossListFixture[1]), false)
})
