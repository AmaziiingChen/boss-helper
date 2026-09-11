export const jobDecisions = ['REJECT', 'REVIEW', 'APPLY'] as const

export type JobDecision = (typeof jobDecisions)[number]

export interface JobMatchResult {
  decision: JobDecision
  reason: string
  matchPoints: string[]
  gaps: string[]
  uncertainties: string[]
}

const resultKeys = ['decision', 'reason', 'matchPoints', 'gaps', 'uncertainties'] as const

export function parseJobMatchResult(content: unknown): JobMatchResult {
  if (content == null || content === '') {
    throw new Error('AI 未返回筛选结果，已停止投递')
  }

  let value: unknown
  if (typeof content === 'string') {
    const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    try {
      value = JSON.parse(fenced?.[1] ?? content.trim())
    } catch {
      throw new Error('AI 返回的内容不是有效 JSON，已停止投递')
    }
  } else {
    value = content
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('AI 返回格式错误，筛选结果必须是 JSON 对象')
  }

  const result = value as Record<string, unknown>
  const keys = Object.keys(result)
  if (keys.length !== resultKeys.length || !resultKeys.every((key) => keys.includes(key))) {
    throw new Error(`AI 返回字段错误，必须且只能包含：${resultKeys.join('、')}`)
  }
  if (!jobDecisions.includes(result.decision as JobDecision)) {
    throw new Error('AI 决策错误，decision 必须是 REJECT、REVIEW 或 APPLY')
  }
  if (typeof result.reason !== 'string' || !result.reason.trim()) {
    throw new Error('AI 返回格式错误，reason 必须是非空文本')
  }

  const parseStringArray = (key: 'matchPoints' | 'gaps' | 'uncertainties') => {
    const items = result[key]
    if (!Array.isArray(items) || !items.every((item) => typeof item === 'string' && item.trim())) {
      throw new Error(`AI 返回格式错误，${key} 必须是文本数组`)
    }
    return items.map((item) => item.trim())
  }

  return {
    decision: result.decision as JobDecision,
    reason: result.reason.trim(),
    matchPoints: parseStringArray('matchPoints'),
    gaps: parseStringArray('gaps'),
    uncertainties: parseStringArray('uncertainties'),
  }
}

export function shouldDeliverJob(
  decision: JobDecision,
  autoDelivery: boolean,
  deliverReview: boolean,
): boolean {
  if (!autoDelivery || decision === 'REJECT') return false
  return decision === 'APPLY' || deliverReview
}
