<script lang="ts" setup>
import Button from 'primevue/button'
import ButtonGroup from 'primevue/buttongroup'
import ProgressBar from 'primevue/progressbar'
import Select from 'primevue/select'
import { computed, onMounted, ref } from 'vue'

import Alert from '@/components/Alert.vue'
import { useConf } from '@/composables/conf'
import { useHelper } from '@/composables/useHelper'

const helper = useHelper()

const { todayData, statisticsData } = helper.statistics

// const { next, page } = usePager()
const conf = useConf()
const statisticCycle = ref(1)

const statisticCycleData = [
  {
    label: '近三日投递',
    help: '愿你每一次投递都能得到回应',
    date: 3,
  },
  {
    label: '本周投递',
    help: '愿你早日找到心满意足的工作',
    date: 7,
  },
  {
    label: '本月投递',
    help: '愿你在面试中得到满意的结果',
    date: 30,
  },
  {
    label: '历史投递',
    help: '愿你能早九晚五还双休带五险',
    date: -1,
  },
]

const cycle = computed(() => {
  const date = statisticCycleData[statisticCycle.value]?.date
  let ans = 0
  if (!date) return ans
  for (
    let i = 0;
    // eslint-disable-next-line no-unmodified-loop-condition
    (date === -1 || i < date - 1) && i < statisticsData.value.length;
    i++
  ) {
    ans += statisticsData.value[i]?.success ?? 0
  }
  return ans
})

onMounted(() => {
  void helper.statistics.updateStatistics()
})
</script>

<template>
  <div class="flex gap-2 flex-col">
    <Alert
      id="config-statistics"
      description="数据并不完全准确，投递上限根据自身情况调整, 建议 120-140, boss限制最高150"
      color="warning"
      show-icon
    />
    <div v-if="conf.configLevel.intermediate" class="grid grid-cols-5 gap-4">
      <div data-help="统计当天脚本扫描过的所有岗位">
        <div class="text-sm text-gray-500">岗位总数：</div>
        <div class="text-2xl font-semibold">
          {{ todayData.total }} <span class="text-sm text-gray-400">份</span>
        </div>
      </div>
      <div data-help="统计当天岗位过滤的比例,被过滤/总数">
        <div class="text-sm text-gray-500">过滤比例：</div>
        <div class="text-2xl font-semibold">
          {{ (((todayData.total - todayData.success) / todayData.total) * 100).toFixed(0) }}
          <span class="text-sm text-gray-400">%</span>
        </div>
      </div>
      <div data-help="统计当天刷到了多少处理过的岗位,重复/总数">
        <div class="text-sm text-gray-500">重复比例：</div>
        <div class="text-2xl font-semibold">
          {{ ((todayData.repeat / todayData.total) * 100).toFixed(0) }}
          <span class="text-sm text-gray-400">%</span>
        </div>
      </div>
      <div data-help="统计当天岗位中的活跃情况,不活跃/总数">
        <div class="text-sm text-gray-500">活跃比例：</div>
        <div class="text-2xl font-semibold">
          {{ ((todayData.activityFilter / todayData.total) * 100).toFixed(0) }}
          <span class="text-sm text-gray-400">%</span>
        </div>
      </div>
      <div :data-help="statisticCycleData[statisticCycle]?.help">
        <Select
          v-model="statisticCycle"
          :options="statisticCycleData.map((item, index) => ({ label: item.label, value: index }))"
          option-label="label"
          option-value="value"
          size="small"
        />
        <div class="text-2xl font-semibold">
          {{ cycle + todayData.success }}
          <span class="text-sm text-gray-400">份</span>
        </div>
      </div>
    </div>
    <div class="flex flex-row gap-2 items-center justify-center">
      <ButtonGroup>
        <Button
          :label="helper.workflow?.status.value === 'stop' ? '继续' : '开始'"
          data-help="点击开始就会开始投递"
          :loading="helper.workflow?.status.value === 'running'"
          @click="helper.start()"
        />
        <Button
          v-if="helper.workflow?.status.value === 'stop'"
          label="重置筛选"
          severity="warn"
          data-help="重置已被筛选的岗位，开始将重新处理"
          @click="helper.reset()"
        />
        <Button
          v-if="helper.workflow?.status.value === 'running'"
          label="暂停"
          severity="warn"
          data-help="暂停后应该能继续"
          @click="helper.stop()"
        />
      </ButtonGroup>
      <ProgressBar
        data-help="我会统计当天脚本投递的数量,该记录并不准确"
        class="flex-1"
        :value="(todayData.success / conf.formData.deliveryLimit.value) * 100"
        :show-value="false"
      />
    </div>
  </div>
</template>

<style lang="scss"></style>
