<script lang="ts" setup>
import Button from 'primevue/button'
import Message from 'primevue/message'
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
import { useHelper } from '@/composables/useHelper'
import type { BossWorkflowState } from '@/entrypoints/boss/delivery'
import {
  deliveryEvidenceLabel,
  hasResumeContent,
  isProcessedStatus,
  workbenchStatusLabel,
} from '@/utils/workbenchState'

import '@/assets/prime-workspace.css'

const helper = useHelper()
const conf = useConf()
const activeView = ref<'workspace' | 'settings'>('workspace')
const settingsTab = ref('automation')
const isRunning = computed(() => helper.workflow?.status.value === 'running')
const selectedJobKey = ref<string | null>(null)
const displayedJobKey = computed(() =>
  selectedJobKey.value && helper.jobList.value.some((job) => job.key === selectedJobKey.value)
    ? selectedJobKey.value
    : helper.currentJob.value,
)
const workflowError = computed(() => helper.workflow?.errorMessage.value)
const pageJobs = computed(() => helper.jobList.value)
const processedCount = computed(
  () =>
    pageJobs.value.filter((job) => isProcessedStatus(helper.jobResultMaps.get(job.key)?.status))
      .length,
)
const readiness = computed(() => {
  const model = helper.models.modelData.value.find(
    (item) => item.key === conf.formData.aiFiltering.model,
  )?.data
  const resumeReady = hasResumeContent(conf.formData.resumeMarkdown.content)
  const feishu = conf.formData.feishu
  return [
    {
      label: workflowError.value
        ? '页面 / 流程状态异常'
        : pageJobs.value.length
          ? `已读取本页 ${pageJobs.value.length} 个岗位`
          : '请打开 BOSS 岗位列表页并等待采集',
      ready: !!helper.workflow && !workflowError.value && pageJobs.value.length > 0,
      tab: '',
    },
    {
      label: resumeReady ? '简历已配置' : '请填写并保存真实简历',
      ready: resumeReady,
      tab: 'resume',
    },
    {
      label: !conf.formData.aiFiltering.enable
        ? 'AI 未启用'
        : model?.base_url.trim() && model.api_key.trim() && model.model.trim()
          ? 'AI 模型已配置'
          : '请保存完整 AI 模型配置',
      ready:
        !conf.formData.aiFiltering.enable ||
        !!(model?.base_url.trim() && model.api_key.trim() && model.model.trim()),
      tab: 'ai',
    },
    {
      label: !feishu.enable
        ? '飞书未启用'
        : [feishu.appId, feishu.appSecret, feishu.appToken, feishu.tableId].every((value) =>
              value.trim(),
            )
          ? '飞书配置完整'
          : '请保存完整飞书配置',
      ready:
        !feishu.enable ||
        [feishu.appId, feishu.appSecret, feishu.appToken, feishu.tableId].every((value) =>
          value.trim(),
        ),
      tab: 'feishu',
    },
  ]
})
const canStart = computed(() => readiness.value.every((item) => item.ready))
const canReset = computed(
  () =>
    !!helper.workflow &&
    pageJobs.value.length > 0 &&
    ((helper.workflow.current.value ?? 0) > 0 ||
      pageJobs.value.some((job) => helper.jobResultMaps.has(job.key))),
)
const policyCopy = '仅采集与分析，不自动投递'
function openSettings(tab: string) {
  settingsTab.value = tab
  activeView.value = 'settings'
}
async function startProcessing() {
  if (!canStart.value || isRunning.value) return
  selectedJobKey.value = null
  await helper.start()
}

const currentData = computed(() => {
  const key = displayedJobKey.value
  return key ? helper.jobMaps.get(key) : undefined
})
const currentJob = computed(
  () =>
    currentData.value?.jobData ?? pageJobs.value.find((job) => job.key === displayedJobKey.value),
)
const currentState = computed(() => currentData.value?.state as BossWorkflowState | undefined)
const match = computed(() => currentState.value?.aiMatchResult)
const currentResult = computed(() => {
  const key = displayedJobKey.value
  return key ? helper.jobResultMaps.get(key) : undefined
})
const currentStatusLabel = computed(() =>
  workbenchStatusLabel(currentResult.value?.status, currentState.value),
)
function jobStatusLabel(key: string) {
  return workbenchStatusLabel(
    helper.jobResultMaps.get(key)?.status,
    helper.jobMaps.get(key)?.state as BossWorkflowState | undefined,
  )
}
function resetProcessing() {
  if (canReset.value && !isRunning.value) helper.reset()
}
const recentLogs = computed(() => helper.logs.value.slice(-5).reverse())
const progress = computed(() => {
  const total = pageJobs.value.length
  return total ? Math.min(100, Math.round((processedCount.value / total) * 100)) : 0
})
const workflowLabel = computed(
  () =>
    ({ running: '正在处理', stop: '已暂停 / 停止', error: '状态异常', pending: '待命' })[
      helper.workflow?.status.value ?? 'pending'
    ],
)
const decisionLabel = computed(() => {
  if (!match.value) return currentResult.value?.status === 'ai' ? 'AI 正在判断' : '尚无 AI 结论'
  return { APPLY: '建议投递', REVIEW: '需要复核', REJECT: '不建议投递' }[match.value.decision]
})
const decisionSeverity = computed<'secondary' | 'success' | 'warn' | 'danger'>(() => {
  if (!match.value) return 'secondary'
  return ({ APPLY: 'success', REVIEW: 'warn', REJECT: 'danger' } as const)[match.value.decision]
})
const progressCopy = computed(() => {
  if (isRunning.value) return '正在逐个读取并判断本页岗位'
  if (workflowError.value) return '请先检查页面连接或流程配置'
  if (helper.workflow?.status.value === 'stop') return '处理已暂停或停止，可查看已有结果'
  return '准备好后开始处理本页岗位'
})
const feishuLabel = computed(() => {
  if (currentState.value?.feishuRecordId) return '飞书已入库'
  return conf.formData.feishu.enable ? '飞书尚无入库凭据' : '飞书未启用'
})
const deliveryLabel = computed(() => deliveryEvidenceLabel(currentState.value?.delivered))
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

    <main v-show="activeView === 'workspace'" class="ph-content">
      <section class="ph-section" aria-labelledby="readiness-title">
        <h2 id="readiness-title">{{ isRunning ? '运行配置' : '开始前检查' }}</h2>
        <p class="ph-run-summary">
          {{ policyCopy }} · {{ conf.formData.feishu.enable ? '同步飞书' : '不同步飞书' }}
        </p>
        <Message v-if="workflowError" severity="error" :closable="false">{{
          workflowError
        }}</Message>
        <ul v-if="!isRunning" class="ph-readiness-list">
          <li v-for="item in readiness" :key="item.tab">
            <span
              ><i
                :class="item.ready ? 'pi pi-check-circle' : 'pi pi-exclamation-circle'"
                aria-hidden="true"
              />
              {{ item.label }}</span
            >
            <Button
              v-if="!item.ready && item.tab"
              label="去设置"
              size="small"
              text
              @click="openSettings(item.tab)"
            />
          </li>
        </ul>
      </section>
      <section
        v-if="pageJobs.length && helper.jobResultMaps.size"
        class="ph-section ph-results"
        aria-labelledby="results-title"
      >
        <div class="ph-section-header">
          <h2 id="results-title">本页处理记录</h2>
          <span class="ph-count">已处理 {{ processedCount }}/{{ pageJobs.length }}</span>
        </div>
        <ul class="ph-result-list">
          <li v-for="job in pageJobs" :key="job.key">
            <Button
              :label="job.jobName || job.positionName"
              :text="displayedJobKey !== job.key"
              severity="secondary"
              size="small"
              :aria-pressed="displayedJobKey === job.key"
              @click="selectedJobKey = job.key"
            />
            <Tag :value="jobStatusLabel(job.key)" severity="secondary" />
          </li>
        </ul>
      </section>
      <div v-if="currentJob" class="ph-job-detail">
        <section
          v-if="currentJob"
          class="ph-section ph-current-job"
          aria-labelledby="current-job-title"
        >
          <div class="ph-section-header">
            <div>
              <span class="ph-kicker">{{ selectedJobKey ? '选中岗位' : '当前岗位' }}</span>
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

        <section v-if="currentJob" class="ph-section ph-decision" aria-labelledby="decision-title">
          <div class="ph-section-header">
            <div>
              <span class="ph-kicker">AI 决策</span>
              <h2 id="decision-title">{{ decisionLabel }}</h2>
            </div>
            <Tag :value="decisionLabel" :severity="decisionSeverity" />
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
              currentResult?.status === 'ai'
                ? 'AI 正在生成判断。'
                : '此岗位尚无有效 AI 结论；可能尚未分析、已被筛选跳过或 AI 未启用。'
            }}
          </p>
        </section>

        <section v-if="currentJob" class="ph-section ph-status" aria-labelledby="status-title">
          <div>
            <span class="ph-kicker">岗位处理状态</span>
            <h2 id="status-title">{{ currentStatusLabel }}</h2>
            <p v-if="currentResult?.reason">{{ currentResult.reason }}</p>
            <p v-else-if="currentResult?.msg">{{ currentResult.msg }}</p>
          </div>
          <div class="ph-status-tags">
            <Tag :value="deliveryLabel" severity="secondary" />
            <Tag :value="feishuLabel" severity="secondary" icon="pi pi-database" />
          </div>
        </section>
      </div>
      <section
        v-if="recentLogs.length"
        class="ph-section ph-activity"
        aria-labelledby="activity-title"
      >
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

    <main v-show="activeView === 'settings'" class="ph-settings">
      <Tabs v-model:value="settingsTab">
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
        <span>本页已处理 {{ processedCount }}/{{ pageJobs.length }}</span>
        <span
          >今日已投递 {{ helper.statistics.todayData.value.success }}/{{
            conf.formData.deliveryLimit.value
          }}</span
        >
      </div>
      <ProgressBar :value="progress" :show-value="false" />
      <div class="ph-actions">
        <Button
          :label="helper.workflow?.status.value === 'stop' ? '继续处理' : '开始处理'"
          icon="pi pi-play"
          :loading="helper.workflow?.status.value === 'running'"
          :disabled="!canStart || isRunning"
          fluid
          @click="startProcessing"
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
          :disabled="!canReset"
          @click="resetProcessing"
        />
      </div>
    </footer>
  </div>
</template>

<style scoped>
.ph-readiness-list,
.ph-result-list {
  display: grid;
  gap: 0.5rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.ph-readiness-list li,
.ph-result-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
}

.ph-readiness-list li > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.ph-result-list {
  max-height: 16rem;
  overflow: auto;
}

.ph-run-summary {
  padding: 0.5rem 0;
}

.ph-status-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.ph-job-detail {
  min-width: 0;
}

.ph-result-list li {
  flex-wrap: wrap;
}

.ph-result-list li > :first-child {
  min-width: 0;
  max-width: 100%;
}

@media (min-width: 900px) {
  .ph-content {
    display: grid;
    grid-template-columns: minmax(18rem, 0.8fr) minmax(0, 1.5fr);
    align-content: start;
    column-gap: 1.5rem;
  }

  .ph-content > * {
    grid-column: 1 / -1;
    min-width: 0;
  }

  .ph-results {
    grid-column: 1;
    align-self: start;
  }

  .ph-job-detail {
    grid-column: 2;
  }

  .ph-result-list {
    max-height: 32rem;
  }
}
</style>
