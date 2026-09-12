import type { JobStatus } from '../composables/useApplying/type'

/** A placeholder or an empty rich-text document is not a usable resume. */
export function hasResumeContent(content: string): boolean {
  const text = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .trim()
  return !!text && !/^姓名\s+手机号/.test(text)
}

/** Missing evidence must not be interpreted as either success or failure. */
export function deliveryEvidenceLabel(delivered: boolean | undefined): string {
  return delivered === true ? '已投递' : delivered === false ? '未投递' : '尚无投递结果'
}

export function isProcessedStatus(status: string | undefined): boolean {
  return status === 'success' || status === 'warn' || status === 'error'
}

export function workbenchStatusLabel(
  status: JobStatus | undefined,
  state: { aiMatchResult?: unknown; delivered?: boolean } | undefined,
): string {
  if (
    (status === 'warn' || status === 'success') &&
    state?.aiMatchResult &&
    state.delivered === false
  ) {
    return '已分析，未投递'
  }
  return {
    pending: '等待开始',
    wait: '等待处理',
    running: '处理中',
    request: '读取岗位详情',
    ai: 'AI 正在判断',
    success: '处理成功',
    warn: '已跳过',
    error: '处理失败',
  }[status ?? 'pending']
}
