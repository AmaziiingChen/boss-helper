import type { BossZpDetailData, BossZpJobItemData } from '../../src/entrypoints/boss/types'

export const bossListFixture = [
  { encryptJobId: 'job-alpha', lid: 'lid-alpha', jobName: '匿名岗位 A' },
  { encryptJobId: 'job-beta', lid: 'lid-beta', jobName: '匿名岗位 B' },
] as unknown as BossZpJobItemData[]

export const bossDetailFixture = {
  lid: 'lid-beta',
  jobInfo: { postDescription: '脱敏 JD B' },
} as unknown as BossZpDetailData
