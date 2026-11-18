import { provide, watch } from 'vue'

import { useHelper } from '@/composables/useHelper'

import { createDraftState } from './draftState'
import { defaultFormData, saveSettingsPatch, settingsConfKey, useConf } from './index'

export function useSettingsDraft(scope: 'ai' | 'feishu' | 'resume' | 'automation') {
  const source = useConf()
  const helper = useHelper()
  const dedicated = ['aiFiltering', 'feishu', 'resumeMarkdown', 'candidateProfile']
  const keys =
    scope === 'automation'
      ? Object.keys(defaultFormData).filter((key) => !dedicated.includes(key))
      : scope === 'resume'
        ? ['resumeMarkdown', 'candidateProfile']
        : [scope === 'ai' ? 'aiFiltering' : 'feishu']
  const { draft, dirty, saving, error, save, reset, pick } = createDraftState(
    source.formData,
    keys,
    async (patch) => {
      if (helper.workflowRunning.value) throw new Error('请先暂停任务，再保存配置')
      await saveSettingsPatch(patch)
    },
  )
  watch(
    () => JSON.stringify(pick(source.formData)),
    () => {
      if (!dirty.value) reset()
    },
  )

  const conf = { ...source, formData: draft, confSaving: save, confReload: async () => reset() }
  provide(settingsConfKey, conf)
  return { conf, dirty, saving, error, save, reset, locked: helper.workflowRunning }
}
