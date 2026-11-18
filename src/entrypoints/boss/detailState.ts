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

/** Inspect rendered notices only. Verification remains a manual action on BOSS. */
export function bossAccessBlockReason(visibleText: string): string | undefined {
  if (/操作过于频繁|访问过于频繁|请求过于频繁/.test(visibleText))
    return 'BOSS 提示操作频繁，请稍后在原站确认后继续'
  if (
    /^(?:请.{0,8}(?:完成|通过).{0,8}验证|(?:人机|人类|安全)验证(?:[，。！!：:\s]|$)|滑动.{0,12}(?:验证|滑块))/m.test(
      visibleText,
    )
  )
    return 'BOSS 需要人工验证，请在原站完成验证后再继续采集'
}

/** A shorter page pause must still wait for a nonempty, updated list. */
export async function waitForBossListChange(
  readList: () => BossZpJobItemData[],
  previous: BossZpJobItemData[],
  isStopped: () => boolean,
  readBlockReason?: () => string | undefined,
): Promise<boolean> {
  const previousIds = previous.map((item) => item.encryptJobId).join('|')
  let interval: ReturnType<typeof setInterval> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const check = () => {
        try {
          if (isStopped()) return resolve(false)
          const blocked = readBlockReason?.()
          if (blocked) return reject(new Error(blocked))
          const list = readList()
          if (list.length && list.map((item) => item.encryptJobId).join('|') !== previousIds)
            resolve(true)
        } catch (error) {
          reject(error)
        }
      }
      timeout = setTimeout(() => reject(new Error('下一页岗位加载超时，请重试采集')), 30_000)
      interval = setInterval(check, 100)
      check()
    })
  } finally {
    clearInterval(interval)
    clearTimeout(timeout)
  }
}

export async function waitForBossDetail(
  readDetail: () => BossZpDetailData | undefined,
  item: BossZpJobItemData,
  options: { isStopped?: () => boolean; readBlockReason?: () => string | undefined } = {},
): Promise<BossZpDetailData> {
  let interval: ReturnType<typeof setInterval> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<BossZpDetailData>((resolve, reject) => {
      const check = () => {
        try {
          if (options.isStopped?.()) return reject(new Error('详情获取已暂停，请继续采集'))
          const blocked = options.readBlockReason?.()
          if (blocked) return reject(new Error(blocked))
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
