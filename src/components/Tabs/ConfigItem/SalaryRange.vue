<script lang="ts" setup>
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'

import { formInfoData, useConf } from '@/composables/conf'

import FormRange from './Form/FormRange.vue'

const conf = useConf()

const salaryRangeAdvanced = ref(false)

function syncSalaryRange() {
  conf.formData.salaryRange.advancedValue.M[0] = Math.round(
    conf.formData.salaryRange.value[0] * 1000,
  )
  conf.formData.salaryRange.advancedValue.M[1] = Math.round(
    conf.formData.salaryRange.value[1] * 1000,
  )

  conf.formData.salaryRange.advancedValue.D[0] = Math.round(
    conf.formData.salaryRange.advancedValue.M[0] / 21.75,
  )
  conf.formData.salaryRange.advancedValue.D[1] = Math.round(
    conf.formData.salaryRange.advancedValue.M[1] / 21.75,
  )

  conf.formData.salaryRange.advancedValue.H[0] = Math.round(
    conf.formData.salaryRange.advancedValue.D[0] / 8,
  )
  conf.formData.salaryRange.advancedValue.H[1] = Math.round(
    conf.formData.salaryRange.advancedValue.D[1] / 8,
  )
}
</script>

<template>
  <FormItem
    label="薪资范围"
    data-help="投递工作的薪资范围, 更多选项可看高级配置"
    v-model:enable="conf.formData.salaryRange.enable"
    class="col-span-2 xl:col-span-1"
  >
    <FormRange :value="conf.formData.salaryRange.value" unit="K" :show="false">
      <Button
        v-if="conf.configLevel.advanced"
        label="高级"
        size="small"
        outlined
        @click="
          () => {
            salaryRangeAdvanced = !salaryRangeAdvanced
          }
        "
      />
    </FormRange>
    <Dialog v-model:visible="salaryRangeAdvanced" modal header="薪资高级设置" class="salary-dialog">
      <div class="salary-popover">
          <Message severity="info" :closable="false">
            宽松匹配：薪资范围有任何重叠即匹配，例如 10–20K 会匹配 15–20K、15–21K 和 20–26K。
          </Message>
          <Message severity="info" :closable="false">
            严格匹配：目标薪资需完全位于职位范围内，例如 10–20K 会匹配 10–15K 和 15–20K。
          </Message>
          <FormRange :value="conf.formData.salaryRange.value" unit="K" :show="true" />
          <Message severity="secondary" :closable="false">
            同步算法固定：日薪 = 月薪 ÷ 21.75，时薪 = 日薪 ÷ 8。
          </Message>
          <Button label="同步计算" @click="syncSalaryRange" />
          <FormRange
            :value="conf.formData.salaryRange.advancedValue.H"
            unit="元/时"
            :show="true"
            :step="5"
          />
          <FormRange
            :value="conf.formData.salaryRange.advancedValue.D"
            unit="元/天"
            :show="true"
            :step="10"
          />
          <FormRange
            :value="conf.formData.salaryRange.advancedValue.M"
            unit="元/月"
            :show="true"
            :step="200"
          />
      </div>
    </Dialog>
  </FormItem>
</template>
