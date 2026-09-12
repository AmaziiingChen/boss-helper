<script lang="ts" setup>
import Accordion from 'primevue/accordion'
import AccordionContent from 'primevue/accordioncontent'
import AccordionHeader from 'primevue/accordionheader'
import AccordionPanel from 'primevue/accordionpanel'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed } from 'vue'

import { useConf } from '@/composables/conf'
import { useHelper } from '@/composables/useHelper'
import type { ConfigAccordionItem } from '@/composables/useHelper/type'

import ConfigItem from './ConfigItem/ConfigItem.vue'

const helper = useHelper()
const conf = useConf()
const configItems = helper.getConfigItems()
const automationSections = computed(() =>
  configItems.value[1].filter((item): item is ConfigAccordionItem => Boolean(item)),
)
</script>

<template>
  <div class="prime-settings-stack">
    <section class="settings-toolbar">
      <h2>自动化设置</h2>
      <div class="settings-toolbar-actions">
        <Button
          v-tooltip.bottom="'配置保存在当前浏览器；任务运行时会锁定筛选项，保存后生效。'"
          icon="pi pi-info-circle"
          severity="secondary"
          text
          rounded
          aria-label="配置说明"
        />
        <Button
          label="推荐值"
          severity="secondary"
          outlined
          size="small"
          @click="conf.confRecommend"
        />
      </div>
    </section>

    <fieldset
      class="prime-settings-fieldset"
      :disabled="helper.workflowRunning.value || conf.isLoading.value"
    >
      <Accordion value="filter">
        <AccordionPanel
          v-for="item in automationSections"
          :key="item.value"
          :value="item.value || String(item.label)"
        >
          <AccordionHeader>{{ item.label }}</AccordionHeader>
          <AccordionContent>
            <div v-if="item.value === 'filter'" class="config-filter-groups">
              <section
                v-for="(entry, index) in item.items"
                :key="index"
                class="config-filter-group"
              >
                <h3>{{ index === 0 ? '关键词规则' : '基础过滤' }}</h3>
                <ConfigItem v-if="entry" :item="entry" />
              </section>
            </div>
            <div v-else class="prime-setting-grid">
              <template v-for="(entry, index) in item.items" :key="index">
                <ConfigItem v-if="entry" :item="entry" />
              </template>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>

      <section class="prime-settings-section">
        <div class="prime-section-heading">
          <h2>运行</h2>
        </div>
        <div class="prime-setting-grid">
          <div class="prime-toggle-row">
            <div>
              <strong>完成时通知</strong>
            </div>
            <ToggleSwitch v-model="conf.formData.notification.value" aria-label="完成时通知" />
          </div>

          <label class="prime-field">
            <span>单日投递上限</span>
            <InputNumber
              v-model="conf.formData.deliveryLimit.value"
              :min="1"
              :max="155"
              :step="10"
              show-buttons
              fluid
            />
          </label>
        </div>
      </section>
    </fieldset>

    <div class="prime-savebar">
      <span />
      <Button
        label="保存配置"
        icon="pi pi-save"
        :loading="conf.isLoading.value"
        @click="conf.confSaving"
      />
    </div>
  </div>
</template>
