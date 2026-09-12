<script lang="ts" setup>
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'
import Tag from 'primevue/tag'
import { computed, ref } from 'vue'

import Resume from '@/components/AI/JobMatchingSettings.vue'
import Ai from '@/components/Tabs/AI.vue'
import Config from '@/components/Tabs/Config.vue'
import Feishu from '@/components/Tabs/Feishu.vue'
import { useConf } from '@/composables/conf'
import type { JobStatus } from '@/composables/useApplying/type'
import { useHelper } from '@/composables/useHelper'
import type { BossWorkflowState } from '@/entrypoints/boss/delivery'

import '@/assets/prime-workspace.css'

const helper = useHelper()
const conf = useConf()
const activeView = ref<'workspace' | 'settings'>('workspace')
const settingsTab = ref('automation')
const isRunning = computed(() => helper.workflow?.status.value === 'running')

const currentData = computed(() => {
  const key = helper.currentJob.value
  return key ? helper.jobMaps.get(key) : undefined
})
const currentJob = computed(() => currentData.value?.jobData)
const currentState = computed(() => currentData.value?.state as BossWorkflowState | undefined)
const match = computed(() => currentState.value?.aiMatchResult)
const currentResult = computed(() => {
  const key = helper.currentJob.value
  return key ? helper.jobResultMaps.get(key) : undefined
})
const currentStatusLabel = computed(() =>
  currentResult.value?.status ? statusLabel[currentResult.value.status] : '等待开始',
)
const recentLogs = computed(() => helper.logs.value.slice(-5).reverse())
const progress = computed(() => {
  const total = helper.workflow?.total.value ?? 0
  const current = helper.workflow?.current.value ?? 0
  return total ? Math.min(100, Math.round((current / total) * 100)) : 0
})
const workflowLabel = computed(() => (isRunning.value ? '正在处理' : '待命'))
const statusLabel: Record<JobStatus, string> = {
  pending: '等待开始',
  wait: '等待处理',
  running: '处理中',
  request: '读取岗位详情',
  ai: 'AI 正在判断',
  success: '已投递',
  warn: '已跳过',
  error: '处理失败',
}
const decisionLabel = computed(() => {
  if (!match.value) return '等待 AI 判断'
  return { APPLY: '建议投递', REVIEW: '需要复核', REJECT: '不建议投递' }[match.value.decision]
})
const decisionSeverity = computed<'secondary' | 'success' | 'warn' | 'danger'>(() => {
  if (!match.value) return 'secondary'
  return ({ APPLY: 'success', REVIEW: 'warn', REJECT: 'danger' } as const)[match.value.decision]
})
const progressCopy = computed(() => {
  if (isRunning.value) return '正在逐个读取并判断本页岗位'
  if (currentResult.value?.status === 'success') return '本轮已完成，可继续浏览下一页岗位'
  return '准备好后开始处理本页岗位'
})
const feishuLabel = computed(() => {
  if (currentState.value?.feishuRecordId) return '飞书已入库'
  return conf.formData.feishu.enable ? '飞书等待入库' : '飞书未启用'
})
</script>

<template>
  <div class="ph-shell">
    <header class="ph-header">
      <div class="ph-heading">
        <div class="ph-product-mark" aria-hidden="true">B</div>
        <div>
          <h1>{{ activeView === 'settings' ? '设置' : '岗位工作台' }}</h1>
          <p v-if="activeView === 'workspace'">{{ progressCopy }}</p>
        </div>
      </div>

      <div class="ph-header-actions">
        <Tag
          v-if="activeView === 'workspace'"
          :value="workflowLabel"
          :severity="isRunning ? 'success' : 'secondary'"
          :icon="isRunning ? 'pi pi-spin pi-spinner' : 'pi pi-circle-fill'"
        />
        <Button
          v-if="activeView === 'workspace'"
          icon="pi pi-cog"
          severity="secondary"
          text
          rounded
          aria-label="打开设置"
          @click="activeView = 'settings'"
        />
        <Button
          v-else
          icon="pi pi-arrow-left"
          severity="secondary"
          text
          rounded
          aria-label="返回岗位工作台"
          @click="activeView = 'workspace'"
        />
      </div>
    </header>

    <main v-if="activeView === 'workspace'" class="ph-content">
      <section class="ph-section ph-current-job" aria-labelledby="current-job-title">
        <div class="ph-section-header">
          <div>
            <span class="ph-kicker">当前岗位</span>
            <template v-if="currentJob">
              <a
                id="current-job-title"
                :href="currentJob.link"
                target="_blank"
                rel="noreferrer"
                class="ph-job-link"
              >
                {{ currentJob.jobName || currentJob.positionName }}
                <i class="pi pi-external-link" aria-hidden="true" />
              </a>
            </template>
            <h2 v-else id="current-job-title">还没有正在处理的岗位</h2>
          </div>
          <Tag v-if="currentJob" :value="currentStatusLabel" severity="secondary" />
        </div>

        <template v-if="currentJob">
          <p class="ph-job-meta">
            <span>{{ currentJob.brand.name }}</span>
            <span>{{ currentJob.salary || '薪资待确认' }}</span>
            <span>{{ currentJob.address || currentJob.city || '地点待确认' }}</span>
          </p>
        </template>
        <p v-else class="ph-empty-copy">
          在 BOSS 岗位列表页开始处理后，这里会显示当前进度和匹配判断。
        </p>
      </section>

      <section class="ph-section ph-decision" aria-labelledby="decision-title">
        <div class="ph-section-header">
          <div>
            <span class="ph-kicker">AI 决策</span>
            <h2 id="decision-title">{{ decisionLabel }}</h2>
          </div>
          <Tag :value="currentStatusLabel" :severity="decisionSeverity" />
        </div>

        <template v-if="match">
          <p class="ph-decision-reason">{{ match.reason }}</p>
          <div class="ph-decision-grid">
            <div v-if="match.matchPoints.length" class="ph-finding">
              <h3><i class="pi pi-check-circle" aria-hidden="true" />匹配点</h3>
              <ul>
                <li v-for="item in match.matchPoints" :key="item">{{ item }}</li>
              </ul>
            </div>
            <div v-if="match.gaps.length" class="ph-finding">
              <h3><i class="pi pi-exclamation-circle" aria-hidden="true" />缺口与风险</h3>
              <ul>
                <li v-for="item in match.gaps" :key="item">{{ item }}</li>
              </ul>
            </div>
            <div v-if="match.uncertainties.length" class="ph-finding">
              <h3><i class="pi pi-question-circle" aria-hidden="true" />待核实</h3>
              <ul>
                <li v-for="item in match.uncertainties" :key="item">{{ item }}</li>
              </ul>
            </div>
          </div>
        </template>
        <p v-else class="ph-empty-copy" aria-live="polite">
          {{
            isRunning
              ? 'AI 正在整理岗位信息并生成判断。'
              : '完成严格格式校验后，这里会显示可执行的匹配结论。'
          }}
        </p>
      </section>

      <section class="ph-section ph-status" aria-labelledby="status-title">
        <div>
          <span class="ph-kicker">本次处理</span>
          <h2 id="status-title">{{ currentStatusLabel }}</h2>
          <p v-if="currentResult?.reason">{{ currentResult.reason }}</p>
          <p v-else-if="currentResult?.msg">{{ currentResult.msg }}</p>
        </div>
        <Tag :value="feishuLabel" severity="secondary" icon="pi pi-database" />
      </section>

      <section class="ph-section ph-activity" aria-labelledby="activity-title">
        <div class="ph-section-header">
          <div>
            <span class="ph-kicker">活动记录</span>
            <h2 id="activity-title">最近动态</h2>
          </div>
          <span class="ph-count">{{ recentLogs.length }} 条</span>
        </div>

        <p v-if="!recentLogs.length" class="ph-empty-copy">处理记录会显示在这里。</p>
        <ol v-else class="ph-activity-list">
          <li v-for="(log, index) in recentLogs" :key="`${log.title}-${index}`">
            <i class="pi pi-circle-fill" aria-hidden="true" />
            <div>
              <strong>{{ log.title }}</strong>
              <p>{{ log.message || log.state_name }}</p>
            </div>
          </li>
        </ol>
      </section>
    </main>

    <main v-else class="ph-settings">
      <Tabs v-model:value="settingsTab" lazy>
        <TabList>
          <Tab value="automation"><i class="pi pi-sliders-h" aria-hidden="true" />自动化</Tab>
          <Tab value="resume"><i class="pi pi-file-edit" aria-hidden="true" />简历</Tab>
          <Tab value="ai"><i class="pi pi-sparkles" aria-hidden="true" />AI</Tab>
          <Tab value="feishu"><i class="pi pi-table" aria-hidden="true" />飞书</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="automation"><Config /></TabPanel>
          <TabPanel value="resume"><Resume /></TabPanel>
          <TabPanel value="ai"><Ai /></TabPanel>
          <TabPanel value="feishu"><Feishu /></TabPanel>
        </TabPanels>
      </Tabs>
    </main>

    <footer v-if="activeView === 'workspace'" class="ph-footer">
      <div class="ph-progress-meta">
        <span
          >本页 {{ helper.workflow?.current.value ?? 0 }}/{{
            helper.workflow?.total.value ?? 0
          }}</span
        >
        <span
          >今日 {{ helper.statistics.todayData.value.success }}/{{
            conf.formData.deliveryLimit.value
          }}</span
        >
      </div>
      <ProgressBar
        :value="isRunning ? undefined : progress"
        :mode="isRunning ? 'indeterminate' : 'determinate'"
        :show-value="false"
      />
      <div class="ph-actions">
        <Button
          :label="helper.workflow?.status.value === 'stop' ? '继续处理' : '开始处理'"
          icon="pi pi-play"
          :loading="helper.workflow?.status.value === 'running'"
          fluid
          @click="helper.start()"
        />
        <Button
          v-if="helper.workflow?.status.value === 'running'"
          label="暂停"
          icon="pi pi-pause"
          severity="warn"
          outlined
          @click="helper.stop()"
        />
        <Button
          v-else
          label="重置"
          style="white-space: nowrap"
          severity="secondary"
          outlined
          @click="helper.reset()"
        />
      </div>
    </footer>
  </div>
</template>
