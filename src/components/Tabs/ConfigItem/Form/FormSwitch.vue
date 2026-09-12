<script lang="ts" setup>
import Button from 'primevue/button'
import ToggleSwitch from 'primevue/toggleswitch'

import type { FormDataAi } from '@/types/formData'

defineProps<{
  label: string
  lock?: boolean
  help?: string
  disabled?: boolean
  data: Partial<FormDataAi>
}>()

defineEmits<{
  (e: 'change', data: Partial<FormDataAi>): void
  (e: 'show'): void
}>()
</script>

<template>
  <div class="setting-toggle-row ai-filter-toggle" :data-help="help">
    <div>
      <strong>{{ label }}</strong>
    </div>
    <div class="setting-toggle-actions">
      <ToggleSwitch
        :model-value="data.enable"
        :disabled="lock || disabled"
        :aria-label="`切换${label}`"
        @update:model-value="$emit('change', data)"
      />
      <Button
        severity="secondary"
        text
        rounded
        icon="pi pi-cog"
        :disabled="lock || disabled"
        :aria-label="`配置${label}`"
        title="配置匹配规则"
        @click="$emit('show')"
      />
    </div>
  </div>
</template>
