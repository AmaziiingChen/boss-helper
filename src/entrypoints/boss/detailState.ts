import type { JobData } from '@/composables/useHelper/type'

import { isDetailForJob } from './detailGuard'
import type { BossZpDetailData, BossZpJobItemData } from './types'

export function applyBossDetail(target: JobData, detail: BossZpDetailData): void {
  target.activeTime = detail.brandComInfo.activeTime
  target.activeTimeStr = detail.bossInfo.activeTimeDesc
  target.jobDescription = detail.jobInfo.postDescription
  target.city = detail.jobInfo.locationName
  target.address = detail.jobInfo.address
  target.addressCoords = [detail.jobInfo.longitude, detail.jobInfo.latitude]
  Object.assign(target.boss, {
    isOnline: detail.bossInfo.bossOnline,
    isCertificated: detail.bossInfo.certificated,
  })
  Object.assign(target.brand, {
    labels: detail.brandComInfo.labels,
    introduce: detail.brandComInfo.introduce,
    stageName: detail.brandComInfo.stageName,
  })
}

/** Keep references held by a running workflow valid when the visible list refreshes. */
export function refreshBossListJob(
  previous: JobData | undefined,
  listed: JobData,
  cachedDetail?: BossZpDetailData,
): JobData {
  const target = previous ? Object.assign(previous, listed) : listed
  if (cachedDetail) applyBossDetail(target, cachedDetail)
  return target
}

export async function waitForBossDetail(
  readDetail: () => BossZpDetailData | undefined,
  item: BossZpJobItemData,
): Promise<BossZpDetailData> {
  let interval: ReturnType<typeof setInterval> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<BossZpDetailData>((resolve, reject) => {
      const check = () => {
        try {
          const detail = readDetail()
          if (detail && isDetailForJob(detail, item)) resolve(detail)
        } catch (error) {
          reject(error)
        }
      }
      timeout = setTimeout(() => reject(new Error('bossZpDetailData获取超时')), 60_000)
      interval = setInterval(check, 100)
      check()
    })
  } finally {
    clearInterval(interval)
    clearTimeout(timeout)
  }
}
