<script lang="ts" setup>
import { generateText } from 'ai'
import Button from 'primevue/button'
import Message from 'primevue/message'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

import LLMForm from '@/components/AI/LLMForm.vue'
import LLMPromptEdit from '@/components/AI/LLMPromptEdit.vue'
import { formInfoData } from '@/composables/conf'
import { useSettingsDraft } from '@/composables/conf/settingsDraft'
import { useHelper } from '@/composables/useHelper'
import { confModelKey, useModel } from '@/composables/useModel'
import type { OpenaiLLMConf } from '@/composables/useModel/openai'
import { openai } from '@/composables/useModel/openai'
import { counter } from '@/message'
import { jsonClone } from '@/utils/deepmerge'

const helper = useHelper()
const { conf, dirty, saving, save } = useSettingsDraft('ai')
const models = useModel()
const testing = ref(false)
const savingModel = ref(false)
const initialized = ref(false)
const modelBaseline = ref('')
const testResult = ref<{ severity: 'success' | 'error' | 'warn'; text: string } | null>(null)
const saveError = ref('')
let testRevision = 0
let testController: AbortController | undefined
const modelKey = ref('')
const modelForm = reactive<OpenaiLLMConf>({ mode: 'openai', base_url: '', api_key: '', model: '' })
const pageDirty = computed(
  () => dirty.value || (initialized.value && JSON.stringify(modelForm) !== modelBaseline.value),
)
const pageSaving = computed(() => saving.value || savingModel.value)

watch(
  modelForm,
  () => {
    testRevision += 1
    testController?.abort()
    testing.value = false
    testResult.value = null
  },
  { deep: true, flush: 'sync' },
)

onBeforeUnmount(() => {
  testRevision += 1
  testController?.abort()
})

onMounted(async () => {
  try {
    await models.initModel()
    const current =
      models.modelData.value.find((item) => item.key === conf.formData.aiFiltering.model) ??
      models.modelData.value[0]
    if (current?.data) {
      modelKey.value = current.key
      Object.assign(modelForm, jsonClone(current.data))
    }
    modelBaseline.value = JSON.stringify(modelForm)
    initialized.value = true
  } catch {
    saveError.value = '模型配置加载失败，请重新打开此页面后再试。'
  }
})

async function saveModel() {
  if (pageSaving.value || !initialized.value || helper.workflowRunning.value) return
  savingModel.value = true
  saveError.value = ''
  const key = modelKey.value || Date.now().toString()
  const next = {
    key,
    name: modelForm.model || 'AI Model',
    data: jsonClone(modelForm),
  }
  const nextModels = jsonClone(models.modelData.value)
  let modelPersisted = false
  try {
    const index = nextModels.findIndex((item) => item.key === key)
    if (index >= 0) nextModels[index] = next
    else nextModels.push(next)
    await counter.storageSet(confModelKey, nextModels)
    models.modelData.value = nextModels
    modelPersisted = true
    modelKey.value = key
    conf.formData.aiFiltering.model = key
    await save()
    modelBaseline.value = JSON.stringify(modelForm)
  } catch {
    saveError.value = modelPersisted
      ? '模型已保存，但 AI 规则保存失败，请重试保存。'
      : '保存失败，修改仍保留在本页，请重试。'
  } finally {
    savingModel.value = false
  }
}

async function testModel() {
  if (!modelForm.base_url.trim() || !modelForm.api_key.trim() || !modelForm.model.trim()) {
    testResult.value = { severity: 'warn', text: '请先填写完整模型配置。' }
    return
  }
  const revision = ++testRevision
  testController?.abort()
  testController = new AbortController()
  testing.value = true
  testResult.value = null
  try {
    await generateText({
      model: openai.createModel(jsonClone(modelForm)),
      prompt: '只回复 OK',
      maxOutputTokens: 8,
      abortSignal: AbortSignal.any([testController.signal, AbortSignal.timeout(60000)]),
    })
    if (revision === testRevision)
      testResult.value = {
        severity: 'success',
        text: '当前配置测试成功，模型已返回响应。测试不会保存配置。',
      }
  } catch {
    if (revision === testRevision)
      testResult.value = {
        severity: 'error',
        text: '当前配置测试失败，请检查地址、密钥、模型名称或网络后重试。',
      }
  } finally {
    if (revision === testRevision) testing.value = false
  }
}
</script>

<template>
  <div class="prime-settings-stack ai-settings">
    <div class="settings-page-body" :inert="pageSaving || !initialized">
      <section class="settings-toolbar">
        <h2>AI 模型</h2>
        <div class="settings-toolbar-actions">
          <Button
            label="测试连接"
            severity="secondary"
            outlined
            :loading="testing"
            :disabled="!initialized"
            @click="testModel"
          />
        </div>
      </section>

      <LLMForm v-model="modelForm" />
      <Message v-if="testResult" :severity="testResult.severity" aria-live="polite">{{
        testResult.text
      }}</Message>
      <Message v-if="saveError" severity="error" aria-live="polite">{{ saveError }}</Message>

      <section class="prime-settings-section">
        <div class="prime-toggle-row">
          <div>
            <strong>{{ formInfoData.aiFiltering.label }}</strong>
          </div>
          <div class="prime-toggle-actions">
            <ToggleSwitch
              v-model="conf.formData.aiFiltering.enable"
              :disabled="helper.workflow?.status.value === 'running'"
              aria-label="AI 简历匹配"
            />
          </div>
        </div>
        <LLMPromptEdit v-if="conf.formData.aiFiltering.enable" data="aiFiltering" />
      </section>
    </div>
    <div class="prime-savebar">
      <span role="status">{{
        helper.workflowRunning.value
          ? '任务运行中，暂停后保存'
          : pageDirty
            ? '有未保存的修改'
            : '无未保存修改'
      }}</span>
      <Button
        label="保存"
        icon="pi pi-save"
        :loading="pageSaving"
        :disabled="!initialized || !pageDirty || helper.workflowRunning.value"
        @click="saveModel"
      />
    </div>
  </div>
</template>
