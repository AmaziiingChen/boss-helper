<script lang="ts" setup>
import Button from 'primevue/button'
import FloatLabel from 'primevue/floatlabel'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, ref } from 'vue'

import { useSettingsDraft } from '@/composables/conf/settingsDraft'

const { conf, dirty, saving, save, locked } = useSettingsDraft('feishu')
const saveError = ref('')
const complete = computed(() => {
  const { appId, appSecret, appToken, tableId } = conf.formData.feishu
  return [appId, appSecret, appToken, tableId].every((value) => value.trim())
})
async function saveSettings() {
  saveError.value = ''
  try {
    await save()
  } catch {
    saveError.value = '保存失败，修改仍保留在本页，请重试。'
  }
}
const permissionHelp =
  '飞书应用需开通 bitable:app 读写权限并发布版本；readonly 权限无法新增或更新记录。'
const permissionUrl = computed(() => {
  const appId = conf.formData.feishu.appId.trim()
  return appId
    ? `https://open.feishu.cn/app/${encodeURIComponent(appId)}/auth?q=bitable%3Aapp&op_from=openapi&token_type=tenant`
    : ''
})
</script>

<template>
  <div class="prime-settings-stack">
    <div class="settings-page-body" :inert="saving">
      <section class="settings-toolbar">
        <h2>飞书</h2>
        <Button
          v-tooltip.bottom="permissionHelp"
          icon="pi pi-info-circle"
          severity="secondary"
          text
          rounded
          aria-label="飞书权限说明"
        />
      </section>

      <div class="prime-toggle-row">
        <div><strong>同步多维表格</strong></div>
        <ToggleSwitch v-model="conf.formData.feishu.enable" aria-label="同步飞书多维表格" />
      </div>

      <Message :severity="complete || !conf.formData.feishu.enable ? 'info' : 'warn'">
        {{
          !conf.formData.feishu.enable
            ? '同步已关闭，已有配置会保留；修改后点击保存生效。'
            : complete
              ? '必填配置已填写，尚未验证连接与表格权限。'
              : '配置未完整填写；保存仅存储本地配置，不验证连接。'
        }}
      </Message>
      <Message v-if="saveError" severity="error" aria-live="polite">{{ saveError }}</Message>

      <section v-if="conf.formData.feishu.enable" class="feishu-form">
        <FloatLabel variant="on">
          <InputText
            id="feishu-app-id"
            v-model="conf.formData.feishu.appId"
            autocomplete="off"
            fluid
          />
          <label for="feishu-app-id">App ID</label>
        </FloatLabel>
        <FloatLabel variant="on">
          <InputText
            id="feishu-app-secret"
            v-model="conf.formData.feishu.appSecret"
            type="password"
            autocomplete="off"
            fluid
          />
          <label for="feishu-app-secret">App Secret</label>
        </FloatLabel>
        <FloatLabel variant="on">
          <InputText
            id="feishu-app-token"
            v-model="conf.formData.feishu.appToken"
            autocomplete="off"
            fluid
          />
          <label for="feishu-app-token">App Token</label>
        </FloatLabel>
        <FloatLabel variant="on">
          <InputText
            id="feishu-table-id"
            v-model="conf.formData.feishu.tableId"
            autocomplete="off"
            fluid
          />
          <label for="feishu-table-id">Table ID</label>
        </FloatLabel>

        <div class="feishu-actions">
          <a v-if="permissionUrl" :href="permissionUrl" target="_blank" rel="noreferrer">
            <Button label="权限设置" severity="secondary" outlined />
          </a>
        </div>
      </section>
    </div>
    <div class="prime-savebar">
      <span role="status">{{
        locked ? '任务运行中，暂停后保存' : dirty ? '有未保存的修改' : '无未保存修改'
      }}</span>
      <Button
        label="保存"
        icon="pi pi-save"
        :loading="saving"
        :disabled="!dirty || locked"
        @click="saveSettings"
      />
    </div>
  </div>
</template>
