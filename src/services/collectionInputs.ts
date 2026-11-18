import type { CollectionState } from './collectionStages'

export interface CollectionInputKeys {
  analysis: string
  storage: string
}
export interface VersionedCollectionState extends CollectionState {
  inputKeys?: CollectionInputKeys
  skippedExisting?: boolean
  aiMatchResult?: unknown
  feishuRecord?: unknown
  feishuRecordId?: string
}

async function hash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function collectionInputKeys(form: any, model: any): Promise<CollectionInputKeys> {
  const analysis = await hash(
    form.aiFiltering.enable
      ? {
          enabled: true,
          resume: form.resumeMarkdown.content,
          profile: form.candidateProfile?.content ?? '',
          prompt: form.aiFiltering.prompt,
          model: model?.data?.model,
          provider: model?.data?.base_url,
          selection: form.aiFiltering.model,
        }
      : { enabled: false },
  )
  return {
    analysis,
    storage: await hash({
      analysis,
      enabled: form.feishu.enable,
      appId: form.feishu.appId,
      appToken: form.feishu.appToken,
      tableId: form.feishu.tableId,
    }),
  }
}

/** Mutate the existing state so the workflow's state map retains the same object. */
export function synchronizeCollectionInputs(
  state: VersionedCollectionState,
  keys: CollectionInputKeys,
) {
  const analysisChanged = state.inputKeys?.analysis !== keys.analysis
  const storageChanged = analysisChanged || state.inputKeys?.storage !== keys.storage
  if (!storageChanged) return false
  if (
    ['analysis', 'storage'].some(
      (key) => state.stages?.[key as 'analysis' | 'storage']?.status === 'running',
    )
  )
    throw new Error('请先等待分析或入库完成，再切换资料。')
  if (state.skippedExisting) {
    delete state.skippedExisting
    if (state.stages?.detail?.status === 'skipped') delete state.stages.detail
  }
  if (analysisChanged) {
    delete state.stages?.analysis
    delete state.aiMatchResult
  }
  delete state.stages?.storage
  delete state.feishuRecord
  delete state.feishuRecordId
  state.inputKeys = { ...keys }
  // Details, confirmed sends and uncertain sends are never reset here.
  return true
}
