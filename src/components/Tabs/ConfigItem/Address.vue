<script lang="ts" setup>
import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'

import { formInfoData, useConf } from '@/composables/conf'
import { useAppToast } from '@/services/appToast'

const conf = useConf()
const toast = useAppToast()

const amapGeocodeLoading = ref(false)

async function amapGeocodeHandler() {
  amapGeocodeLoading.value = true
  try {
    const res = await amapGeocode(conf.formData.amap.origins)
    if (res) {
      conf.formData.amap.origins = res.location
    } else {
      toast.add({
        title: '获取地址失败',
        color: 'error',
      })
    }
  } catch (error) {
    toast.add({
      title: '获取地址失败',
      color: 'error',
    })
    logger.error('AmapGeocodeError', error)
  } finally {
    amapGeocodeLoading.value = false
  }
}

function gotoAmapDevSetting() {
  window.open('https://lbs.amap.com/dev/', '_blank')
}
</script>

<template>
  <div class="address-settings">
    <div class="address-master-row">
      <div>
        <strong>通勤距离筛选</strong>
        <span>根据起点与岗位地址计算距离和时间</span>
      </div>
      <ToggleSwitch
        v-model="conf.formData.amap.enable"
        v-bind="formInfoData.amap.enable"
        aria-label="通勤距离筛选"
      />
    </div>

    <div v-if="conf.formData.amap.enable" class="address-config-body">
      <section class="address-section">
        <div class="address-section-heading">
          <strong>定位来源</strong>
          <Button
            label="创建 Key"
            severity="secondary"
            text
            size="small"
            @click="gotoAmapDevSetting"
          />
        </div>
        <label class="prime-field" :title="formInfoData.amap.key['data-help']">
          <span>高德地图 Key</span>
          <InputText v-model="conf.formData.amap.key" fluid />
        </label>
        <label class="prime-field" :title="formInfoData.amap.origins['data-help']">
          <span>{{ formInfoData.amap.origins.label }}</span>
          <div class="prime-input-action">
            <InputText v-model="conf.formData.amap.origins" :disabled="amapGeocodeLoading" fluid />
            <Button
              icon="pi pi-map-marker"
              size="small"
              aria-label="根据完整地址获取经纬度"
              title="根据完整地址获取经纬度"
              :loading="amapGeocodeLoading"
              @click="amapGeocodeHandler()"
            />
          </div>
        </label>
      </section>

      <section class="address-section">
        <div class="address-section-heading"><strong>通勤上限</strong></div>
        <div class="address-limit-list">
          <label class="address-limit-row" :title="formInfoData.amap.straightDistance['data-help']">
            <span>{{ formInfoData.amap.straightDistance.label }}</span>
            <div class="prime-input-unit">
              <InputNumber
                v-model="conf.formData.amap.straightDistance"
                :min-fraction-digits="1"
                :max-fraction-digits="1"
                :max="1000"
                :min="0"
                :step="1"
                fluid
              />
              <span>km</span>
            </div>
          </label>
          <label class="address-limit-row" :title="formInfoData.amap.drivingDistance['data-help']">
            <span>{{ formInfoData.amap.drivingDistance.label }}</span>
            <div class="prime-input-unit">
              <InputNumber
                v-model="conf.formData.amap.drivingDistance"
                :min-fraction-digits="1"
                :max-fraction-digits="1"
                :max="1000"
                :min="0"
                :step="1"
                fluid
              />
              <span>km</span>
            </div>
          </label>
          <label class="address-limit-row" :title="formInfoData.amap.drivingDuration['data-help']">
            <span>{{ formInfoData.amap.drivingDuration.label }}</span>
            <div class="prime-input-unit">
              <InputNumber
                v-model="conf.formData.amap.drivingDuration"
                :min-fraction-digits="0"
                :max-fraction-digits="2"
                :max="1440"
                :min="0"
                :step="30"
                fluid
              />
              <span>分钟</span>
            </div>
          </label>
          <label class="address-limit-row" :title="formInfoData.amap.walkingDistance['data-help']">
            <span>{{ formInfoData.amap.walkingDistance.label }}</span>
            <div class="prime-input-unit">
              <InputNumber
                v-model="conf.formData.amap.walkingDistance"
                :min-fraction-digits="1"
                :max-fraction-digits="1"
                :max="1000"
                :min="0"
                :step="1"
                fluid
              />
              <span>km</span>
            </div>
          </label>
          <label class="address-limit-row" :title="formInfoData.amap.walkingDuration['data-help']">
            <span>{{ formInfoData.amap.walkingDuration.label }}</span>
            <div class="prime-input-unit">
              <InputNumber
                v-model="conf.formData.amap.walkingDuration"
                :min-fraction-digits="0"
                :max-fraction-digits="2"
                :max="1440"
                :min="0"
                :step="30"
                fluid
              />
              <span>分钟</span>
            </div>
          </label>
        </div>
      </section>

      <details class="address-prompt-details">
        <summary>AI 提示词变量</summary>
        <div class="address-prompt-vars">
          <span v-pre>{{ amap.straightDistance }} km</span>
          <span v-pre>{{ amap.drivingDistance }} km</span>
          <span v-pre>{{ amap.drivingDuration }} 分钟</span>
          <span v-pre>{{ amap.walkingDistance }} km</span>
          <span v-pre>{{ amap.walkingDuration }} 分钟</span>
        </div>
      </details>
    </div>
  </div>
</template>
