import type { CollectionState, StageKey, StageStatus } from '../services/collectionStages'

export type CollectionViewState = CollectionState & {
  delivered?: boolean
  skippedExisting?: boolean
  feishuRecordId?: string
  aiMatchResult?: { decision: 'APPLY' | 'REVIEW' | 'REJECT' }
}
export const collectionKeys = ['detail', 'analysis', 'storage'] as const
export const stageNames: Record<StageKey, string> = {
  detail: '详情获取',
  analysis: 'AI 分析',
  storage: '飞书入库',
  delivery: '独立投递',
}
const successNames: Record<StageKey, string> = {
  detail: '详情已获取',
  analysis: '已分析',
  storage: '已入库',
  delivery: '已投递',
}
const failedNames: Record<StageKey, string> = {
  detail: '获取失败',
  analysis: '分析失败',
  storage: '入库失败',
  delivery: '投递未完成',
}
const severities = {
  pending: 'secondary',
  running: 'info',
  succeeded: 'success',
  skipped: 'secondary',
  failed: 'danger',
  unknown: 'warn',
} as const

/** Show short diagnostics, never raw response bodies or provider credentials. */
export function safeStageMessage(message: string | null | undefined): string {
  if (!message) return ''
  if (/^\s*(?:\[|\{)|<!doctype|<html|"(?:headers|request|response|body)"\s*:/i.test(message)) {
    return '服务返回异常，请检查对应配置后重试；原始响应未展示。'
  }
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, '[接口地址]')
    .replace(/Bearer\s+[^\s,]+|sk-[\w-]{8,}/gi, '[凭据已隐藏]')
    .replace(
      /(?:api[_ -]?key|app[_ -]?secret|access[_ -]?token|tenant[_ -]?access[_ -]?token|authorization)["']?\s*[:=]\s*["']?[^\s,"']+/gi,
      '[凭据已隐藏]',
    )
    .slice(0, 300)
}

export function stageView(key: StageKey, state?: CollectionViewState) {
  const stage = state?.stages?.[key]
  let status: StageStatus = stage?.status ?? 'pending'
  // Preserve older confirmed evidence, but never hide an uncertain live send.
  if (!stage && key === 'delivery' && state?.delivered) status = 'succeeded'
  if (!stage && key === 'storage' && state?.feishuRecordId) status = 'succeeded'
  const label =
    status === 'succeeded'
      ? successNames[key]
      : status === 'failed'
        ? failedNames[key]
        : status === 'skipped'
          ? state?.skippedExisting && key !== 'delivery'
            ? key === 'storage'
              ? '飞书已有'
              : '已跳过'
            : key === 'delivery'
              ? '按规则跳过'
              : '未启用'
          : status === 'unknown'
            ? key === 'delivery'
              ? '发送结果待核实'
              : '结果待核实'
            : status === 'running'
              ? '处理中'
              : key === 'delivery'
                ? '未投递'
                : '待处理'
  return {
    key,
    name: stageNames[key],
    status,
    label,
    severity: severities[status],
    attempts: stage?.attempts ?? 0,
    message: safeStageMessage(stage?.message),
  }
}

export function failedCollectionStages(state?: CollectionViewState) {
  return collectionKeys.filter((key) => state?.stages?.[key]?.status === 'failed')
}

/** Progress is relative to discovered jobs, not a promise about future pages. */
export function collectionProgress(states: CollectionViewState[]) {
  const completed = states.filter((state) =>
    collectionKeys.every((key) =>
      ['succeeded', 'skipped'].includes(state.stages?.[key]?.status ?? 'pending'),
    ),
  ).length
  return {
    completed,
    total: states.length,
    value: states.length ? Math.floor((completed / states.length) * 100) : 0,
  }
}

export function collectionLabel(state?: CollectionViewState) {
  if (state?.skippedExisting) return '飞书已有，已跳过'
  const failed = failedCollectionStages(state)
  if (failed.length) return failed.map((key) => failedNames[key]).join('、')
  if (collectionKeys.some((key) => state?.stages?.[key]?.status === 'running')) return '采集中'
  if (
    collectionKeys.every((key) =>
      ['succeeded', 'skipped'].includes(state?.stages?.[key]?.status ?? 'pending'),
    )
  )
    return '采集完成'
  return '待采集'
}

export function deliveryBlockReason(
  state: CollectionViewState | undefined,
  reviewAllowed: boolean,
  busy: boolean,
  quotaReached: boolean,
): string {
  if (!state) return '当前会话未找到该岗位'
  const status = state.stages?.delivery?.status
  if (status === 'unknown') return '发送结果待核实，请到 BOSS 查看沟通记录；不能直接重发'
  if (status === 'running') return '投递处理中，请等待结果；不能重复发送'
  if (state.delivered || status === 'succeeded') return '该岗位已投递'
  if (busy) return '请先暂停或等待当前任务结束'
  if (
    state.stages?.detail?.status !== 'succeeded' ||
    state.stages?.analysis?.status !== 'succeeded' ||
    !state.aiMatchResult
  )
    return '请先完成该岗位的详情获取和 AI 分析'
  if (state.aiMatchResult.decision === 'REJECT') return 'AI 不建议投递，该岗位不可投递'
  if (state.aiMatchResult.decision === 'REVIEW' && !reviewAllowed)
    return '请先在自动化设置中允许确认投递 REVIEW 岗位'
  if (quotaReached) return '已达到今日投递上限'
  return ''
}
