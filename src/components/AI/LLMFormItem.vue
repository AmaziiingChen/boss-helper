<script lang="ts" setup generic="T extends object">
import Checkbox from 'primevue/checkbox'
import InputNumber from 'primevue/inputnumber'
import Message from 'primevue/message'
import Select from 'primevue/select'

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
const componentConfig = (config: unknown): any => config
</script>

<template>
  <template v-if="'alert' in info">
    <Message :severity="info.alert === 'warning' ? 'warn' : info.alert" :closable="false" class="model-form-alert">
      <strong>{{ info.label }}</strong>
      <span v-if="info.desc">{{ info.desc }}</span>
    </Message>
    <div class="model-form-group">
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

  <label v-else class="prime-field model-form-field">
    <span :title="info.desc" class="model-form-label">
      <i v-if="info.desc" class="pi pi-info-circle" aria-hidden="true" />
      {{ info.label ?? label }}
    </span>
    <Checkbox
      v-if="!info.required"
      v-model="isSetVal"
      binary
      @update:model-value="
        (x) => {
          if (!x) fromVal = undefined
        }
      "
    />
    <template v-if="info.required || isSetVal">
      <InputNumber
        v-if="info.type === 'input' && info.format === 'number'"
        v-model="fromVal"
        v-bind="componentConfig(info.config)"
        fluid
      />
      <Select
        v-else-if="info.type === 'input'"
        v-model="fromVal"
        option-value="value"
        option-label="label"
        v-bind="componentConfig(info.config)"
        editable
        fluid
      />
    </template>
  </label>
</template>
