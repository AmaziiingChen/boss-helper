import assert from 'node:assert/strict'
import test from 'node:test'

import type { JobData } from '../src/composables/useHelper/type.ts'
import {
  applyBossDetail,
  bossAccessBlockReason,
  refreshBossListJob,
  waitForBossDetail,
  waitForBossListChange,
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

void test('pagination waits through an empty loading state and returns when jobs actually change', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const previous = bossListFixture.slice()
  let visible = previous
  let reads = 0
  const pending = waitForBossListChange(
    () => {
      reads++
      return visible
    },
    previous,
    () => false,
  )
  t.mock.timers.tick(5_000)
  visible = []
  t.mock.timers.tick(100)
  visible = [previous[0]!, { ...previous[1]!, encryptJobId: 'new-job' }]
  t.mock.timers.tick(100)
  assert.equal(await pending, true)
  const completedReads = reads
  t.mock.timers.tick(60_000)
  assert.equal(reads, completedReads)
})

void test('pagination timeout reports an error instead of treating the old list as final', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const pending = waitForBossListChange(
    () => bossListFixture,
    bossListFixture,
    () => false,
  )
  const rejected = assert.rejects(pending, /下一页岗位加载超时/)
  t.mock.timers.tick(30_000)
  await rejected
})

void test('pagination can pause without leaving a polling timer', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let stopped = false
  let reads = 0
  const pending = waitForBossListChange(
    () => {
      reads++
      return bossListFixture
    },
    bossListFixture,
    () => stopped,
  )
  stopped = true
  t.mock.timers.tick(100)
  assert.equal(await pending, false)
  const pausedReads = reads
  t.mock.timers.tick(60_000)
  assert.equal(reads, pausedReads)
})

void test('visible verification and frequency notices produce actionable pause reasons', () => {
  assert.match(bossAccessBlockReason('操作过于频繁，请稍后重试')!, /操作频繁/)
  assert.match(bossAccessBlockReason('安全验证\n请完成下方验证后继续')!, /原站完成验证/)
  assert.match(bossAccessBlockReason('请完成下方验证后继续')!, /人工验证/)
  assert.equal(bossAccessBlockReason('安全验证工程师\n负责安全验证流程设计'), undefined)
  assert.equal(bossAccessBlockReason('岗位列表\n正常加载'), undefined)
})

for (const stopped of [false, true]) {
  void test(`detail wait releases timers promptly on ${stopped ? 'pause' : 'verification'}`, async (t) => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
    let block = false
    let reads = 0
    const pending = waitForBossDetail(
      () => {
        reads++
        return undefined
      },
      bossListFixture[1],
      {
        isStopped: () => stopped && block,
        readBlockReason: () => (!stopped && block ? '请在原站完成验证' : undefined),
      },
    )
    const rejected = assert.rejects(pending, stopped ? /已暂停/ : /原站完成验证/)
    block = true
    t.mock.timers.tick(100)
    await rejected
    const last = reads
    t.mock.timers.tick(120_000)
    assert.equal(reads, last)
  })
}

void test('page wait stops on verification instead of treating the unchanged list as completion', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  const pending = waitForBossListChange(
    () => bossListFixture,
    bossListFixture,
    () => false,
    () => 'BOSS 需要人工验证',
  )
  await assert.rejects(pending, /人工验证/)
})
