<script lang="ts" setup>
import SelectButton from 'primevue/selectbutton'
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
        <span>{{ label }}</span>
        <ToggleSwitch v-model="enable" :disabled="disabled" :aria-label="label" />
      </label>
    </div>
    <div v-if="enable" class="filter-rule-control">
      <SelectButton
        v-if="include != null"
        v-model="include"
        :options="[
          { label: '包含', value: true },
          { label: '排除', value: false },
        ]"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        :disabled="disabled"
        :aria-label="`${label}匹配方式`"
        size="small"
      />
      <slot />
    </div>
  </div>
</template>
