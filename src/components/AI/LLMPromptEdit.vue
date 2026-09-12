<script lang="ts" setup>
import Button from 'primevue/button'
import SelectButton from 'primevue/selectbutton'
import Textarea from 'primevue/textarea'
import { computed, ref } from 'vue'

import { defaultFormData, useConf } from '@/composables/conf'
import type { Prompt } from '@/types/formData'
import { jsonClone } from '@/utils/deepmerge'

const props = defineProps<{ data: 'aiFiltering' }>()
const conf = useConf()
const message = ref<Prompt>(jsonClone(conf.formData[props.data].prompt))
const activeRole = ref<'system' | 'user'>('system')
const roles = [
  { label: 'System', value: 'system' },
  { label: 'User', value: 'user' },
]
const activeMessage = computed({
  get: () => message.value.find((item) => item.role === activeRole.value)?.content ?? '',
  set: (content: string) => {
    const item = message.value.find((value) => value.role === activeRole.value)
    if (item) item.content = content
    else message.value.push({ role: activeRole.value, content })
  },
})

function resetPrompt() {
  message.value = jsonClone(defaultFormData[props.data].prompt)
}

async function savePrompt() {
  conf.formData[props.data].prompt = jsonClone(message.value)
  await conf.confSaving()
}
</script>

<template>
  <div class="inline-prompt-editor is-open">
    <div class="inline-prompt-editor-clip">
      <div class="inline-prompt-editor-content">
        <div class="prompt-toolbar">
          <strong>匹配规则</strong>
          <Button label="恢复示例" severity="secondary" text size="small" @click="resetPrompt" />
        </div>

        <p class="prompt-helper">
          双花括号可引用岗位变量。查看
          <a
            href="https://github.com/Ocyss/boss-helper/blob/master/src/types/bossData.d.ts"
            target="_blank"
            rel="noreferrer"
            >变量表</a
          >
          或
          <a
            href="https://langgptai.feishu.cn/wiki/RXdbwRyASiShtDky381ciwFEnpe"
            target="_blank"
            rel="noreferrer"
            >提示词文档</a
          >。
        </p>

        <div class="prompt-role-editor">
          <SelectButton
            v-model="activeRole"
            :options="roles"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            aria-label="选择消息角色"
          />
          <Textarea v-model="activeMessage" rows="7" fluid />
        </div>

        <div class="inline-prompt-actions">
          <Button label="保存规则" size="small" @click="savePrompt" />
        </div>
      </div>
    </div>
  </div>
</template>
