<script lang="ts" setup>
import Button from 'primevue/button'
import ToggleSwitch from 'primevue/toggleswitch'

defineProps<{
  label: string
  help?: string
  disabled?: boolean
}>()

const include = defineModel<boolean | undefined>('include', {
  default: undefined,
})
const enable = defineModel<boolean>('enable', { required: true })
</script>

<template>
  <div class="filter-rule" role="group" :aria-label="label" :data-help="help" :title="help">
    <div class="filter-rule-heading">
      <label class="prime-check-label">
        <ToggleSwitch v-model="enable" :disabled="disabled" />
        <span>{{ label }}</span>
      </label>
      <Button
        v-if="include != null"
        class="filter-rule-mode"
        :severity="include ? 'primary' : 'warn'"
        :label="include ? '包含' : '排除'"
        text
        size="small"
        :disabled
        @click="include = !include"
      />
    </div>
    <div v-if="enable" class="filter-rule-control"><slot /></div>
  </div>
</template>
