<script lang="ts" setup>
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'

const props = withDefaults(
  defineProps<{
    value: [number, number, boolean]
    unit: string
    show: boolean
    step?: number
    controls?: boolean
  }>(),
  {
    controls: true,
  },
)

const handleToggle = () => {
  props.value[2] = !props.value[2]
}
</script>

<template>
  <div class="range-control">
    <InputNumber
      v-model="props.value[0]"
      :min="0"
      :step="props.step"
      :show-buttons="props.controls"
    />
    <span class="range-separator" aria-hidden="true">至</span>
    <InputNumber
      v-model="props.value[1]"
      :min="0"
      :step="props.step"
      :show-buttons="props.controls"
    />

    <span class="range-unit">{{ props.unit }}</span>
    <Button
      v-if="props.show"
      :label="props.value[2] ? '严格' : '宽松'"
      severity="secondary"
      text
      size="small"
      @click="handleToggle"
    />
    <slot />
  </div>
</template>
