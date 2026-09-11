import type { BossZpDetailData, BossZpJobItemData } from './types'

/**
 * BOSS refreshes jobDetail asynchronously. Never attach the visible detail to a
 * different list item while the user or workflow is switching cards.
 */
export function isDetailForJob(
  detail: BossZpDetailData | undefined,
  job: BossZpJobItemData,
): boolean {
  return Boolean(detail && detail.lid === job.lid)
}
