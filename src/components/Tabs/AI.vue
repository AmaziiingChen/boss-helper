<script lang="ts" setup>
import { generateText } from 'ai'
import Button from 'primevue/button'
import ToggleSwitch from 'primevue/toggleswitch'
import { onMounted, reactive, ref } from 'vue'

import LLMForm from '@/components/AI/LLMForm.vue'
import LLMPromptEdit from '@/components/AI/LLMPromptEdit.vue'
import { formInfoData, useConf } from '@/composables/conf'
import { useHelper } from '@/composables/useHelper'
import { useModel } from '@/composables/useModel'
import type { OpenaiLLMConf } from '@/composables/useModel/openai'
import { openai } from '@/composables/useModel/openai'
import { useAppToast } from '@/services/appToast'
import { jsonClone } from '@/utils/deepmerge'

const helper = useHelper()
const conf = useConf()
const models = useModel()
const toast = useAppToast()
const testing = ref(false)
const modelKey = ref('')
const modelForm = reactive<OpenaiLLMConf>({ mode: 'openai', base_url: '', api_key: '', model: '' })

onMounted(async () => {
  await models.initModel()
  const current =
    models.modelData.value.find((item) => item.key === conf.formData.aiFiltering.model) ??
    models.modelData.value[0]
  if (!current?.data) return
  modelKey.value = current.key
  Object.assign(modelForm, jsonClone(current.data))
})

async function saveModel() {
  const key = modelKey.value || Date.now().toString()
  const next = {
    key,
    name: modelForm.model || 'AI Model',
    data: jsonClone(modelForm),
  }
  const index = models.modelData.value.findIndex((item) => item.key === key)
  if (index >= 0) models.modelData.value[index] = next
  else models.modelData.value.push(next)
  modelKey.value = key
  conf.formData.aiFiltering.model = key
  await models.saveModelSilently()
  await conf.confSaving()
}

async function testModel() {
  if (!modelForm.base_url.trim() || !modelForm.api_key.trim() || !modelForm.model.trim()) {
    toast.add({ title: '请先填写完整模型配置', color: 'warning' })
    return
  }
  testing.value = true
  try {
    const result = await generateText({
      model: openai.createModel(modelForm),
      prompt: '只回复 OK',
      maxOutputTokens: 8,
      abortSignal: AbortSignal.timeout(60000),
    })
    toast.add({
      title: '连接成功',
      description: result.text.trim() || '模型已返回响应',
      color: 'success',
    })
  } catch (error) {
    toast.add({ title: '连接失败', description: errorHandle(error), color: 'error' })
  } finally {
    testing.value = false
  }
}

function changeAiEnabled(value: boolean) {
  conf.formData.aiFiltering.enable = value
  void conf.confSaving()
}
</script>

<template>
  <div class="prime-settings-stack ai-settings">
    <section class="settings-toolbar">
      <h2>AI 模型</h2>
      <div class="settings-toolbar-actions">
        <Button label="测试" severity="secondary" outlined :loading="testing" @click="testModel" />
        <Button label="保存" icon="pi pi-save" @click="saveModel" />
      </div>
    </section>

    <LLMForm v-model="modelForm" />

    <section class="prime-settings-section">
      <div class="prime-toggle-row">
        <div>
          <strong>{{ formInfoData.aiFiltering.label }}</strong>
        </div>
        <div class="prime-toggle-actions">
          <ToggleSwitch
            :model-value="conf.formData.aiFiltering.enable"
            :disabled="helper.workflow?.status.value === 'running'"
            aria-label="AI 简历匹配"
            @update:model-value="changeAiEnabled"
          />
        </div>
      </div>
      <div class="prime-toggle-row">
        <div><strong>自动投递</strong></div>
        <ToggleSwitch v-model="conf.formData.autoDelivery.value" aria-label="自动投递" />
      </div>
      <div class="prime-toggle-row" :class="{ 'is-disabled': !conf.formData.autoDelivery.value }">
        <div><strong>REVIEW 也投递</strong></div>
        <ToggleSwitch
          v-model="conf.formData.deliverReview.value"
          :disabled="!conf.formData.autoDelivery.value"
          aria-label="REVIEW 也投递"
        />
      </div>
      <LLMPromptEdit v-if="conf.formData.aiFiltering.enable" data="aiFiltering" />
    </section>
  </div>
</template>
