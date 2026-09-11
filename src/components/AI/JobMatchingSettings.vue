<script lang="ts" setup>
import { computed, ref } from 'vue'

import { useConf } from '@/composables/conf'

const conf = useConf()
const fileInput = ref<HTMLInputElement>()
const loadingFile = ref(false)
const feishuPermissionUrl = computed(() => {
  const appId = conf.formData.feishu.appId.trim()
  if (!appId) return ''
  return `https://open.feishu.cn/app/${encodeURIComponent(appId)}/auth?q=bitable%3Aapp&op_from=openapi&token_type=tenant`
})

async function importMarkdown(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  loadingFile.value = true
  try {
    conf.formData.resumeMarkdown.content = await file.text()
    conf.formData.resumeMarkdown.fileName = file.name
  } finally {
    loadingFile.value = false
    input.value = ''
  }
}

async function save() {
  await conf.confSaving()
}
</script>

<template>
  <div class="rounded-lg border border-default p-4 flex flex-col gap-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <div class="font-medium">简历匹配与投递</div>
        <div class="text-sm text-muted">
          简历文件不会上传；文本保存在浏览器本地，匹配时发送给你配置的 AI 模型。
        </div>
      </div>
      <UButton color="primary" @click="save">保存设置</UButton>
    </div>

    <UFormField label="Markdown 简历">
      <div class="flex flex-col gap-2 w-full">
        <div class="flex items-center gap-2">
          <input
            ref="fileInput"
            class="hidden"
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            @change="importMarkdown"
          />
          <UButton
            color="neutral"
            variant="outline"
            :loading="loadingFile"
            @click="fileInput?.click()"
          >
            选择 Markdown
          </UButton>
          <span class="text-sm text-muted">{{
            conf.formData.resumeMarkdown.fileName || '未选择文件'
          }}</span>
        </div>
        <UTextarea
          v-model="conf.formData.resumeMarkdown.content"
          :rows="7"
          autoresize
          :maxrows="14"
          class="w-full"
          placeholder="也可以直接粘贴简历 Markdown 全文"
        />
      </div>
    </UFormField>

    <div class="flex flex-wrap gap-5">
      <UCheckbox v-model="conf.formData.autoDelivery.value" label="开启自动投递" />
      <UCheckbox
        v-model="conf.formData.deliverReview.value"
        label="REVIEW 也投递"
        :disabled="!conf.formData.autoDelivery.value"
      />
    </div>

    <div class="border-t border-default pt-4 flex flex-col gap-3">
      <UCheckbox v-model="conf.formData.feishu.enable" label="同步飞书多维表格" />
      <div v-if="conf.formData.feishu.enable" class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <UAlert
          class="md:col-span-2"
          color="info"
          title="飞书应用须开通 bitable:app 多维表格读写权限并发布版本；readonly 权限不足以新增或更新记录。"
        />
        <a
          v-if="feishuPermissionUrl"
          class="md:col-span-2 w-fit"
          :href="feishuPermissionUrl"
          target="_blank"
          rel="noreferrer"
        >
          <UButton color="neutral" variant="outline">打开飞书权限管理</UButton>
        </a>
        <div class="md:col-span-2 text-sm text-muted">
          同时请在飞书表中创建文本字段：AI 判断理由、AI 匹配点、AI 缺口与风险、AI 待核实项。
        </div>
        <UFormField label="App ID"><UInput v-model="conf.formData.feishu.appId" /></UFormField>
        <UFormField label="App Secret">
          <UInput v-model="conf.formData.feishu.appSecret" type="password" />
        </UFormField>
        <UFormField label="app_token"
          ><UInput v-model="conf.formData.feishu.appToken"
        /></UFormField>
        <UFormField label="table_id"><UInput v-model="conf.formData.feishu.tableId" /></UFormField>
      </div>
    </div>
  </div>
</template>
