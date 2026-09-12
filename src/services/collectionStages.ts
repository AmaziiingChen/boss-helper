export const stageKeys = ['detail', 'analysis', 'storage', 'delivery'] as const
export type StageKey = (typeof stageKeys)[number]

export const stageStatuses = [
  'pending',
  'running',
  'succeeded',
  'skipped',
  'failed',
  'unknown',
] as const
export type StageStatus = (typeof stageStatuses)[number]

export interface StageState {
  status: StageStatus
  message?: string
  startedAt?: number
  finishedAt?: number
  attempts: number
}

export interface CollectionState {
  stages?: Partial<Record<StageKey, StageState>>
}

export interface RunStageOptions {
  isStopped?: () => boolean
  enabled?: boolean
  onRunning?: () => void | Promise<void>
}

/** False means the pipeline must stop; skipped and cached stages may continue. */
export async function runStage(
  state: CollectionState,
  key: StageKey,
  action: () => unknown | Promise<unknown>,
  { isStopped, enabled = true, onRunning }: RunStageOptions = {},
): Promise<boolean> {
  if (isStopped?.()) return false
  const previous = state.stages?.[key]
  if (previous?.status === 'succeeded') return true
  // An uncertain delivery needs reconciliation, never an automatic resend.
  if (previous?.status === 'running' || previous?.status === 'unknown') return false

  state.stages ??= {}
  if (!enabled) {
    state.stages[key] = {
      status: 'skipped',
      attempts: previous?.attempts ?? 0,
      finishedAt: Date.now(),
    }
    return true
  }

  const current: StageState = {
    status: 'running',
    attempts: (previous?.attempts ?? 0) + 1,
    startedAt: Date.now(),
  }
  state.stages[key] = current
  try {
    await onRunning?.()
    if (isStopped?.()) {
      if (previous) state.stages[key] = previous
      else delete state.stages[key]
      return false
    }
    await action()
    current.status = 'succeeded'
    current.finishedAt = Date.now()
    return true
  } catch (error) {
    current.status = 'failed'
    current.message = error instanceof Error ? error.message : String(error)
    current.finishedAt = Date.now()
    throw error
  }
}

export function summarizeCollection(states: Iterable<CollectionState>): {
  total: number
  stages: Record<StageKey, Record<StageStatus, number>>
} {
  const stages = Object.fromEntries(
    stageKeys.map((key) => [key, Object.fromEntries(stageStatuses.map((status) => [status, 0]))]),
  ) as Record<StageKey, Record<StageStatus, number>>
  let total = 0
  for (const state of states) {
    total++
    for (const key of stageKeys) stages[key][state.stages?.[key]?.status ?? 'pending']++
  }
  return { total, stages }
}
