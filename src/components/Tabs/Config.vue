<script lang="ts" setup>
import Accordion from 'primevue/accordion'
import AccordionContent from 'primevue/accordioncontent'
import AccordionHeader from 'primevue/accordionheader'
import AccordionPanel from 'primevue/accordionpanel'
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Message from 'primevue/message'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, ref } from 'vue'

import { defaultFormData } from '@/composables/conf'
import { useSettingsDraft } from '@/composables/conf/settingsDraft'
import { useHelper } from '@/composables/useHelper'
import type { ConfigAccordionItem } from '@/composables/useHelper/type'
import { jsonClone } from '@/utils/deepmerge'

import ConfigItem from './ConfigItem/ConfigItem.vue'

const helper = useHelper()
const { conf, dirty, saving, error, save, reset } = useSettingsDraft('automation')
const beforeRecommended = ref<Record<string, unknown>>()
function recommend() {
  const keys = [
    'deliveryLimit',
    'activityFilter',
    'friendStatus',
    'sameCompanyFilter',
    'sameHrFilter',
    'goldHunterFilter',
    'notification',
    'delayDeliveryStarts',
    'delayDeliveryInterval',
    'delayDeliveryPageNext',
  ]
  beforeRecommended.value = Object.fromEntries(
    keys.map((key) => [key, jsonClone(conf.formData[key])]),
  )
  for (const key of keys) conf.formData[key] = jsonClone(defaultFormData[key])
}
function undoRecommend() {
  Object.assign(conf.formData, beforeRecommended.value)
  beforeRecommended.value = undefined
}
async function savePage() {
  try {
    await save()
    beforeRecommended.value = undefined
  } catch {
    /* inline error */
  }
}
const configItems = helper.getConfigItems()
const automationSections = computed(() =>
  configItems.value[1].filter((item): item is ConfigAccordionItem => Boolean(item)),
)
</script>

<template>
  <div class="prime-settings-stack">
    <div class="settings-page-body">
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
            :disabled="helper.workflowRunning.value"
            @click="recommend"
          />
        </div>
      </section>
      <Message v-if="beforeRecommended" severity="info" :closable="false">
        已将运行频率与基础过滤恢复为推荐值；关键词、地址和投递开关未更改。
        <Button label="撤销" text size="small" @click="undoRecommend" />
      </Message>

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
            <h2>投递策略</h2>
            <p>开始处理仅采集、分析与入库，不自动投递。投递需要单独确认。</p>
          </div>
          <div class="prime-toggle-row">
            <strong>允许确认投递 REVIEW 岗位</strong>
            <ToggleSwitch
              v-model="conf.formData.deliverReview.value"
              aria-label="允许确认投递 REVIEW 岗位"
            />
          </div>
        </section>
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
    </div>
    <Message v-if="error" severity="error" :closable="false">保存失败：{{ error }}</Message>
    <div class="prime-savebar">
      <span role="status">{{ dirty ? '有未保存修改' : '已保存' }}</span>
      <div class="settings-toolbar-actions">
        <Button
          v-if="dirty"
          label="撤销修改"
          text
          severity="secondary"
          :disabled="saving"
          @click="reset"
        />
        <Button
          label="保存配置"
          icon="pi pi-save"
          :loading="saving"
          :disabled="!dirty || helper.workflowRunning.value"
          @click="savePage"
        />
      </div>
    </div>
  </div>
</template>
