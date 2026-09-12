<script lang="ts" setup>
import Button from 'primevue/button'
import FloatLabel from 'primevue/floatlabel'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed } from 'vue'

import { useConf } from '@/composables/conf'

const conf = useConf()
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
        <Button label="保存" icon="pi pi-save" @click="conf.confSaving" />
      </div>
    </section>
  </div>
</template>
