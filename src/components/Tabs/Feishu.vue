<script lang="ts" setup>
import Button from 'primevue/button'
import FloatLabel from 'primevue/floatlabel'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, ref } from 'vue'

import SettingsPage from '@/components/SettingsPage.vue'
import { useSettingsDraft } from '@/composables/conf/settingsDraft'
import { useFeishuConnectionCheck } from '@/composables/useFeishuConnectionCheck'

const { conf, dirty, saving, save, locked } = useSettingsDraft('feishu')
const saveError = ref('')
const {
  testing,
  report,
  steps,
  stale,
  lastCheckedAt,
  error: testError,
  run: testConnection,
} = useFeishuConnectionCheck(() => conf.formData.feishu)
const checkedTime = computed(() =>
  lastCheckedAt.value === null
    ? ''
    : new Date(lastCheckedAt.value).toLocaleString('zh-CN', { hour12: false }),
)
const stepLabels = {
  pending: '待检查',
  running: '检查中',
  success: '通过',
  error: '未通过',
  skipped: '未检查',
} as const
const stepSeverity = {
  pending: 'secondary',
  running: 'info',
  success: 'success',
  error: 'danger',
  skipped: 'secondary',
} as const
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
  <SettingsPage
    title="飞书"
    :dirty="dirty"
    :saving="saving"
    :locked="locked"
    :error="saveError"
    @save="saveSettings"
  >
    <template #actions>
      <Button
        v-tooltip.bottom="permissionHelp"
        icon="pi pi-info-circle"
        severity="secondary"
        text
        rounded
        aria-label="飞书权限说明"
      />
      <Button
        label="测试连接"
        severity="secondary"
        outlined
        :loading="testing"
        :disabled="!complete || locked"
        @click="testConnection"
      />
    </template>

    <div class="prime-toggle-row">
      <div><strong>同步多维表格</strong></div>
      <ToggleSwitch v-model="conf.formData.feishu.enable" aria-label="同步飞书多维表格" />
    </div>

    <Message :severity="complete || !conf.formData.feishu.enable ? 'info' : 'warn'">
      {{
        !conf.formData.feishu.enable
          ? '同步已关闭，已有配置会保留；修改后点击保存生效。'
          : complete
            ? '必填配置已填写。测试连接仅检查读取能力与字段兼容，不验证写入权限。'
            : '配置未完整填写；保存仅存储本地配置，不验证连接。'
      }}
    </Message>

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
      <Message severity="info" variant="simple">
        测试当前填写的配置，无需先保存；不会新增记录或修改表结构。
      </Message>
    </section>

    <section
      v-if="testing || report || stale || testError"
      class="feishu-form"
      aria-label="飞书连接检查结果"
      aria-live="polite"
      :aria-busy="testing"
    >
      <Message v-if="stale" severity="warn">配置已修改，旧检查结果已失效，请重新测试。</Message>
      <Message v-else-if="testError" severity="error">{{ testError }}</Message>
      <Message v-else-if="report" :severity="report.success ? 'success' : 'error'">
        {{
          report.success
            ? '连接与字段检查通过（只读）。尚未验证记录写入权限。'
            : '检查未通过，请根据下方提示修正配置。'
        }}
      </Message>
      <div v-for="step in steps" :key="step.id">
        <Tag
          :severity="stepSeverity[step.status]"
          :value="`${step.label} · ${stepLabels[step.status]}`"
        />
        <Message
          v-if="step.message"
          :severity="step.status === 'error' ? 'error' : 'secondary'"
          variant="simple"
          >{{ step.message }}</Message
        >
      </div>
      <span v-if="checkedTime">上次完成检查：{{ checkedTime }}{{ stale ? '（已失效）' : '' }}</span>
    </section>
  </SettingsPage>
</template>
