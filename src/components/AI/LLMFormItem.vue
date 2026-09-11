<script lang="ts" setup generic="T extends object">
import UInput from '@nuxt/ui/components/Input.vue'
import UInputNumber from '@nuxt/ui/components/InputNumber.vue'

import type { LLMInfoValM, LLMInfoValF } from '@/composables/useModel/type'

const props = defineProps<{
  info: LLMInfoValM<T, object> | LLMInfoValF<T, any>
  label: string
  depth?: number
}>()

const fromVal = defineModel<any>({
  required: true,
})

const isSetVal = ref(fromVal.value !== undefined)
</script>

<template>
  <template v-if="'alert' in info">
    <UAlert
      :title="info.label"
      :description="info.desc"
      :color="info.alert"
      variant="subtle"
      class="mb-4 relative left-1/2 -translate-x-1/2 w-[102%]"
    />
    <div class="space-y-3">
      <LLMFormItem
        v-for="(x, k) in info.value"
        :key="k"
        :label="k"
        v-model="fromVal[k]"
        :info="x"
        :depth="(depth || 0) + 1"
      />
    </div>
  </template>

  <UFormField
    v-else
    :required="info.required"
    class="w-full"
    :ui="{ container: 'flex flex-row gap-2 flex-1 *:w-full max-w-3/5' }"
  >
    <template #label>
      <span :title="info.desc" class="inline-flex items-center text-center gap-2">
        <UIcon v-if="info.desc" name="i-lucide-info" />
        {{ info.label ?? label }}</span
      >
    </template>
    <UCheckbox
      v-if="!info.required"
      v-model="isSetVal"
      @update:model-value="
        (x) => {
          if (!x) fromVal = undefined
        }
      "
    />
    <template v-if="info.required || isSetVal">
      <UInputNumber
        v-if="info.type === 'input' && info.format === 'number'"
        v-model="fromVal"
        v-bind="info.config"
      ></UInputNumber>
      <UInput v-else-if="info.type === 'input'" v-model="fromVal" v-bind="info.config"></UInput>
    </template>
  </UFormField>
</template>
