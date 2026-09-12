import { computed, reactive, ref } from 'vue'

import { jsonClone } from '../../utils/deepmerge.ts'

/** Retain local edits while committing only the fields owned by this page. */
export function createDraftState<T extends Record<string, any>>(
  source: T,
  keys: string[],
  persist: (patch: Partial<T>) => Promise<void>,
) {
  const draft = reactive(jsonClone(source)) as T
  const pick = (value: T) =>
    Object.fromEntries(keys.map((key) => [key, jsonClone(value[key])])) as Partial<T>
  const baseline = ref(JSON.stringify(pick(source)))
  const dirty = computed(() => JSON.stringify(pick(draft)) !== baseline.value)
  const saving = ref(false)
  const error = ref('')
  function reset() {
    Object.assign(draft, pick(source))
    baseline.value = JSON.stringify(pick(source))
    error.value = ''
  }
  async function save() {
    if (saving.value) return
    saving.value = true
    error.value = ''
    const patch = pick(draft)
    try {
      await persist(patch)
      baseline.value = JSON.stringify(patch)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      saving.value = false
    }
  }
  return { draft, dirty, saving, error, save, reset, pick }
}
