import assert from 'node:assert/strict'
import test from 'node:test'

import type { JobData } from '../src/composables/useHelper/type.ts'
import {
  applyBossDetail,
  refreshBossListJob,
  waitForBossDetail,
} from '../src/entrypoints/boss/detailState.ts'
import type { BossZpDetailData } from '../src/entrypoints/boss/types.ts'
import { bossListFixture } from './fixtures/boss-jobs.ts'

const detail = {
  lid: 'lid-beta',
  jobInfo: {
    postDescription: '完整 JD',
    locationName: '测试城市',
    address: '测试地址',
    longitude: 120,
    latitude: 30,
  },
  brandComInfo: {
    activeTime: 123,
    labels: ['测试标签'],
    introduce: '公司介绍',
    stageName: '未融资',
  },
  bossInfo: { activeTimeDesc: '今日活跃', bossOnline: true, certificated: true },
} as unknown as BossZpDetailData

function listedJob(salary = '10-15K'): JobData {
  return {
    key: 'boss::job-beta',
    jobName: '匿名岗位',
    jobDescription: '',
    address: '列表地址',
    salary,
    boss: { name: '测试招聘者', isOnline: false },
    brand: { name: '测试公司', introduce: '', labels: [] },
  } as JobData
}

void test('a repeated list item keeps its object identity and full cached JD while updating list fields', () => {
  const job = listedJob()
  applyBossDetail(job, detail)
  const refreshed = refreshBossListJob(job, listedJob('15-20K'), detail)
  assert.equal(refreshed, job)
  assert.equal(job.salary, '15-20K')
  assert.equal(job.jobDescription, '完整 JD')
  assert.equal(job.address, '测试地址')
  assert.equal(job.city, '测试城市')
  assert.deepEqual(job.addressCoords, [120, 30])
  assert.equal(job.brand.introduce, '公司介绍')
  assert.equal(job.boss.isOnline, true)
  assert.equal(job.boss.name, '测试招聘者')
})

void test('cache-hit hydration repairs an empty job without fetching another detail', () => {
  const job = listedJob()
  applyBossDetail(job, detail)
  assert.equal(job.jobDescription, '完整 JD')
  assert.deepEqual(job.brand.labels, ['测试标签'])
  const uncached = listedJob()
  assert.equal(refreshBossListJob(undefined, uncached), uncached)
  assert.equal(uncached.jobDescription, '')
})

void test('detail polling ignores unrelated cards and clears both timers on success', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const clearIntervalMock = t.mock.method(globalThis, 'clearInterval')
  const clearTimeoutMock = t.mock.method(globalThis, 'clearTimeout')
  let visible = { ...detail, lid: 'lid-alpha' }
  let reads = 0
  const pending = waitForBossDetail(() => {
    reads++
    return visible
  }, bossListFixture[1])
  t.mock.timers.tick(100)
  visible = detail
  t.mock.timers.tick(100)
  assert.equal(await pending, detail)
  assert.equal(clearIntervalMock.mock.callCount(), 1)
  assert.equal(clearTimeoutMock.mock.callCount(), 1)
  const completedReads = reads
  t.mock.timers.tick(120_000)
  assert.equal(reads, completedReads)
})

void test('detail timeout rejects and leaves no polling behind', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const clearIntervalMock = t.mock.method(globalThis, 'clearInterval')
  const clearTimeoutMock = t.mock.method(globalThis, 'clearTimeout')
  let reads = 0
  const pending = waitForBossDetail(() => {
    reads++
    return undefined
  }, bossListFixture[1])
  const rejected = assert.rejects(pending, /获取超时/)
  t.mock.timers.tick(60_000)
  await rejected
  assert.equal(clearIntervalMock.mock.callCount(), 1)
  assert.equal(clearTimeoutMock.mock.callCount(), 1)
  const completedReads = reads
  t.mock.timers.tick(120_000)
  assert.equal(reads, completedReads)
})

void test('a detail reader error also cleans up both timers', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const clearIntervalMock = t.mock.method(globalThis, 'clearInterval')
  const clearTimeoutMock = t.mock.method(globalThis, 'clearTimeout')
  await assert.rejects(
    waitForBossDetail(() => {
      throw new Error('reader failed')
    }, bossListFixture[1]),
    /reader failed/,
  )
  assert.equal(clearIntervalMock.mock.callCount(), 1)
  assert.equal(clearTimeoutMock.mock.callCount(), 1)
})
