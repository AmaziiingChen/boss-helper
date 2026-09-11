<script lang="ts" setup>
import { ref } from 'vue'

import JobMatchingSettings from '@/components/AI/JobMatchingSettings.vue'
import LLMModelManage from '@/components/AI/LLMModelManage.vue'
import LLMPromptEdit from '@/components/AI/LLMPromptEdit.vue'
import FormSwitch from '@/components/Tabs/ConfigItem/Form/FormSwitch.vue'
import { formInfoData, useConf } from '@/composables/conf'
import { useHelper } from '@/composables/useHelper'
import type { FormDataAi } from '@/types/formData'

const helper = useHelper()
const conf = useConf()
const aiBoxShow = ref(false)
const aiConfBoxShow = ref(false)
const aiBox = ref<'aiFiltering'>('aiFiltering')

function change(v: Partial<FormDataAi>) {
  v.enable = !v.enable
  conf.confSaving()
}
</script>

<template>
  <div class="flex flex-col gap-3" data-help="AI 配置">
    <JobMatchingSettings />
    <div class="flex flex-wrap gap-3">
      <FormSwitch
        :label="formInfoData.aiFiltering.label"
        :data-help="formInfoData.aiFiltering['data-help']"
        :data="conf.formData.aiFiltering"
        :lock="helper.workflow?.status.value === 'running'"
        @show="
          () => {
            aiBox = 'aiFiltering'
            aiBoxShow = true
          }
        "
        @change="change"
      />
    </div>
    <div>
      <LLMModelManage>
        <UButton
          color="primary"
          data-help="配置需要使用的LLM大模型"
          @click="
            () => {
              aiConfBoxShow = true
            }
          "
        >
          模型配置
        </UButton>
      </LLMModelManage>
    </div>

    <LLMPromptEdit
      v-if="aiBoxShow"
      v-model="aiBoxShow"
      v-key="aiBox"
      :data="aiBox"
    />
  </div>
</template>
