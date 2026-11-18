import { onScopeDispose, ref, shallowRef, watch } from 'vue'

import { testFeishuConnection } from '../services/feishu'
import type { FeishuConnectionReport, FeishuConnectionStep } from '../services/feishu'
import type { FeishuConfig } from '../types/formData'

export function useFeishuConnectionCheck(config: () => FeishuConfig, check = testFeishuConnection) {
  const testing = ref(false)
  const report = shallowRef<FeishuConnectionReport | null>(null)
  const steps = ref<FeishuConnectionStep[]>([])
  const stale = ref(false)
  const lastCheckedAt = ref<number | null>(null)
  const error = ref('')
  let revision = 0
  let disposed = false

  watch(
    () => {
      const value = config()
      return [value.appId, value.appSecret, value.appToken, value.tableId]
    },
    () => {
      revision++
      stale.value = testing.value || lastCheckedAt.value !== null
      report.value = null
      steps.value = []
      error.value = ''
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    disposed = true
    revision++
  })

  async function run() {
    if (testing.value || disposed) return
    const version = revision
    const snapshot = { ...config() }
    testing.value = true
    stale.value = false
    report.value = null
    error.value = ''
    steps.value = []
    try {
      const result = await check(snapshot, (progress) => {
        if (!disposed && version === revision) steps.value = progress
      })
      if (!disposed && version === revision) {
        report.value = result
        steps.value = result.steps
        lastCheckedAt.value = result.checkedAt
      }
    } catch {
      if (!disposed && version === revision) error.value = '连接检测未能完成，请稍后重试。'
    } finally {
      if (!disposed) testing.value = false
    }
  }
  return { testing, report, steps, stale, lastCheckedAt, error, run }
}
