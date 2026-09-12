<script lang="ts" setup>
import Accordion from 'primevue/accordion'
import AccordionContent from 'primevue/accordioncontent'
import AccordionHeader from 'primevue/accordionheader'
import AccordionPanel from 'primevue/accordionpanel'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'
import Tag from 'primevue/tag'
import Timeline from 'primevue/timeline'
import { computed, ref } from 'vue'

import Resume from '@/components/AI/JobMatchingSettings.vue'
import Ai from '@/components/Tabs/AI.vue'
import Config from '@/components/Tabs/Config.vue'
import Feishu from '@/components/Tabs/Feishu.vue'
import { useConf } from '@/composables/conf'
import { useHelper } from '@/composables/useHelper'
import type { BossWorkflowState } from '@/entrypoints/boss/delivery'
import {
  collectionKeys,
  collectionLabel,
  deliveryBlockReason,
  failedCollectionStages,
  safeStageMessage,
  stageNames,
  stageView,
} from '@/utils/collectionView'
import { hasResumeContent } from '@/utils/workbenchState'

import '@/assets/prime-workspace.css'

const helper = useHelper()
const conf = useConf()
const activeView = ref<'workspace' | 'settings'>('workspace')
const settingsTab = ref('automation')
const requesting = ref(false)
const isRunning = computed(() => !!helper.workflowRunning.value)
const isBusy = computed(() => isRunning.value || requesting.value)
const actionError = ref('')
const actionNotice = ref('')
const sessionJobs = computed(() => [...helper.jobMaps.values()].map((record) => record.jobData))
const summary = computed(() => helper.collectionSummary.value)
const failureSummary = computed(() =>
  collectionKeys
    .filter((key) => summary.value.stages[key].failed > 0)
    .map((key) => `${stageNames[key]}失败 ${summary.value.stages[key].failed}`)
    .join('；'),
)
const selectedJobKey = ref<string | null>(null)
const displayedJobKey = computed(() =>
  selectedJobKey.value && helper.jobMaps.has(selectedJobKey.value)
    ? selectedJobKey.value
    : (helper.currentJob.value ?? sessionJobs.value[0]?.key),
)
const workflowError = computed(() => safeStageMessage(helper.workflow?.errorMessage.value))
const pageJobs = computed(() => helper.jobList.value)
const readiness = computed(() => {
  const model = helper.models.modelData.value.find(
    (item) => item.key === conf.formData.aiFiltering.model,
  )?.data
  const resumeReady = hasResumeContent(conf.formData.resumeMarkdown.content)
  const feishu = conf.formData.feishu
  return [
    {
      label: pageJobs.value.length
        ? `已读取本页 ${pageJobs.value.length} 个岗位`
        : workflowError.value
          ? '尚未连接到可用 BOSS 岗位列表'
          : '当前页尚未发现岗位，请检查 BOSS 搜索与筛选',
      ready: !!helper.workflow && pageJobs.value.length > 0,
      tab: '',
    },
    {
      label: resumeReady ? '简历已配置' : '请填写并保存真实简历',
      ready: !conf.formData.aiFiltering.enable || resumeReady,
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
  ].filter((item) => item.tab !== 'resume' || conf.formData.aiFiltering.enable)
})
const canStart = computed(() => readiness.value.every((item) => item.ready))
const canReset = computed(() => !!helper.workflow && helper.jobResultMaps.size > 0)
const policyCopy = '仅采集与分析，不自动投递'
function openSettings(tab: string) {
  settingsTab.value = tab
  activeView.value = 'settings'
}
async function startProcessing() {
  if (!canStart.value || isBusy.value) return
  selectedJobKey.value = null
  await requestAction(() => helper.start())
}

async function requestAction(action: () => Promise<void>) {
  if (isBusy.value) return
  requesting.value = true
  actionError.value = ''
  actionNotice.value = ''
  try {
    await action()
    // A side-panel command receipt is not completion of the business action.
    if (!helper.workflow?.errorMessage.value)
      actionNotice.value = '请求已提交，实际结果请查看阶段状态。'
  } catch (error) {
    actionError.value = safeStageMessage(error instanceof Error ? error.message : String(error))
  } finally {
    requesting.value = false
  }
}

function canRetryJob(key: string) {
  const state = helper.jobMaps.get(key)?.state as BossWorkflowState | undefined
  return (
    !isBusy.value &&
    failedCollectionStages(state).length > 0 &&
    !collectionKeys.some((stage) =>
      ['running', 'unknown'].includes(state?.stages?.[stage]?.status ?? 'pending'),
    )
  )
}
async function retryJob(key: string) {
  if (!canRetryJob(key)) return
  selectedJobKey.value = key
  await requestAction(() => helper.retryJob(key))
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
const currentStages = computed(() =>
  collectionKeys.map((key) => stageView(key, currentState.value)),
)
const currentStatusLabel = computed(() => collectionLabel(currentState.value))
function jobStatusLabel(key: string) {
  return collectionLabel(stateFor(key))
}
function stateFor(key: string) {
  return helper.jobMaps.get(key)?.state as BossWorkflowState | undefined
}
function jobStage(key: string, stage: (typeof collectionKeys)[number]) {
  return stageView(stage, stateFor(key))
}
function decisionFor(key: string) {
  const result = (helper.jobMaps.get(key)?.state as BossWorkflowState | undefined)?.aiMatchResult
  return result
    ? { APPLY: '建议投递', REVIEW: '需复核', REJECT: '不建议投递' }[result.decision]
    : ''
}
function resetProcessing() {
  if (canReset.value && !isBusy.value) helper.reset()
}
const recentLogs = computed(() => helper.logs.value.slice(-5).reverse())
const workflowLabel = computed(() =>
  isBusy.value
    ? '任务运行中'
    : { running: '正在处理', stop: '已暂停 / 停止', error: '状态异常', pending: '待命' }[
        helper.workflow?.status.value ?? 'pending'
      ],
)
const decisionLabel = computed(() => {
  if (!match.value)
    return currentState.value?.stages?.analysis?.status === 'skipped' ? 'AI 未启用' : '尚无 AI 结论'
  return { APPLY: '建议投递', REVIEW: '需要复核', REJECT: '不建议投递' }[match.value.decision]
})
const decisionSeverity = computed<'secondary' | 'success' | 'warn' | 'danger'>(() => {
  if (!match.value) return 'secondary'
  return ({ APPLY: 'success', REVIEW: 'warn', REJECT: 'danger' } as const)[match.value.decision]
})
const progressCopy = computed(() => {
  if (isBusy.value) return '正在处理，已成功的阶段会保留'
  if (workflowError.value) return '请先检查页面连接或流程配置'
  if (helper.workflow?.status.value === 'stop') return '处理已暂停或停止，可查看已有结果'
  return '采集范围由 BOSS 页面的搜索和筛选决定'
})
const deliveryStage = computed(() => stageView('delivery', currentState.value))
const quotaReached = computed(
  () => helper.statistics.todayData.value.success >= conf.formData.deliveryLimit.value,
)
const deliveryReason = computed(() =>
  deliveryBlockReason(
    currentState.value,
    conf.formData.deliverReview.value,
    isBusy.value,
    quotaReached.value,
  ),
)
const deliveryKey = ref<string | null>(null)
const deliveryDialog = ref(false)
const deliveryTarget = computed(() =>
  deliveryKey.value ? helper.jobMaps.get(deliveryKey.value) : undefined,
)
const confirmReason = computed(() =>
  deliveryBlockReason(
    deliveryKey.value ? stateFor(deliveryKey.value) : undefined,
    conf.formData.deliverReview.value,
    isBusy.value,
    quotaReached.value,
  ),
)
function openDelivery() {
  if (deliveryReason.value || !currentJob.value) return
  deliveryKey.value = currentJob.value.key
  deliveryDialog.value = true
}
async function confirmDelivery() {
  const key = deliveryKey.value
  if (!deliveryDialog.value || !key || confirmReason.value) return
  deliveryDialog.value = false
  await requestAction(() => helper.deliverJob(key))
}
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
          :severity="isBusy ? 'info' : 'secondary'"
          :icon="isBusy ? 'pi pi-spin pi-spinner' : 'pi pi-circle-fill'"
        />
        <Button
          v-if="activeView === 'workspace'"
          icon="pi pi-cog"
          severity="secondary"
          text
          rounded
          aria-label="打开设置"
          :disabled="requesting"
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
        <Message v-if="actionError" severity="error" :closable="false">{{ actionError }}</Message>
        <p v-if="actionNotice && !workflowError" class="ph-empty-copy" role="status">
          {{ actionNotice }}
        </p>
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
        <div class="ph-session-summary" aria-label="本次会话汇总">
          <span
            >发现 <strong>{{ summary.total }}</strong></span
          >
          <span
            >详情成功 <strong>{{ summary.stages.detail.succeeded }}</strong></span
          >
          <span
            >分析成功 <strong>{{ summary.stages.analysis.succeeded }}</strong></span
          >
          <span
            >入库成功 <strong>{{ summary.stages.storage.succeeded }}</strong></span
          >
        </div>
        <Message v-if="failureSummary" severity="warn" :closable="false"
          >{{ failureSummary }}。可选择失败岗位重试。</Message
        >
        <p class="ph-empty-copy">记录仅保留在当前 BOSS 页面会话；刷新该页面后不会恢复。</p>
      </section>
      <section
        v-if="sessionJobs.length"
        class="ph-section ph-results"
        aria-labelledby="results-title"
      >
        <div class="ph-section-header">
          <h2 id="results-title">本次会话岗位</h2>
          <span class="ph-count">{{ sessionJobs.length }} 个</span>
        </div>
        <ul class="ph-result-list">
          <li v-for="job in sessionJobs" :key="job.key" class="ph-record">
            <Button
              :label="job.jobName || job.positionName"
              :text="displayedJobKey !== job.key"
              severity="secondary"
              size="small"
              :aria-pressed="displayedJobKey === job.key"
              @click="selectedJobKey = job.key"
            />
            <span class="ph-record-company">{{ job.brand.name }}</span>
            <div class="ph-status-tags">
              <Tag
                :value="jobStatusLabel(job.key)"
                :severity="
                  failedCollectionStages(stateFor(job.key)).length ? 'danger' : 'secondary'
                "
              />
              <Tag v-if="decisionFor(job.key)" :value="decisionFor(job.key)" severity="secondary" />
            </div>
            <div class="ph-record-stages">
              <Tag
                v-for="stage in collectionKeys"
                :key="stage"
                :value="`${stageNames[stage]}：${jobStage(job.key, stage).label}`"
                :severity="jobStage(job.key, stage).severity"
              />
            </div>
            <Button
              v-if="failedCollectionStages(stateFor(job.key)).length"
              label="重试该岗位"
              size="small"
              severity="secondary"
              outlined
              :disabled="!canRetryJob(job.key)"
              @click="retryJob(job.key)"
            />
          </li>
        </ul>
      </section>
      <section v-else-if="pageJobs.length" class="ph-section">
        <p class="ph-empty-copy">
          尚未开始采集。点击“开始采集”后，这里将保留跨翻页的岗位和阶段结果。
        </p>
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

        <section class="ph-section" aria-labelledby="stages-title">
          <div class="ph-section-header">
            <h2 id="stages-title">采集阶段</h2>
            <Button
              v-if="failedCollectionStages(currentState).length && displayedJobKey"
              label="重试该岗位"
              severity="secondary"
              outlined
              size="small"
              :disabled="!canRetryJob(displayedJobKey)"
              @click="retryJob(displayedJobKey)"
            />
          </div>
          <Timeline
            :value="currentStages"
            class="ph-stages"
            :pt="{
              eventOpposite: { style: 'flex: 0 0 6rem' },
              eventContent: { style: 'min-width: 0' },
            }"
          >
            <template #opposite="{ item }"
              ><span class="ph-stage-name">{{ item.name }}</span></template
            >
            <template #content="{ item }">
              <div class="ph-stage-content">
                <Tag :value="item.label" :severity="item.severity" />
                <span class="ph-count">尝试 {{ item.attempts }} 次</span>
                <Accordion
                  v-if="item.message"
                  :value="item.status === 'failed' ? 'error' : undefined"
                >
                  <AccordionPanel value="error">
                    <AccordionHeader>查看原因</AccordionHeader>
                    <AccordionContent
                      ><p class="ph-stage-message">{{ item.message }}</p></AccordionContent
                    >
                  </AccordionPanel>
                </Accordion>
              </div>
            </template>
          </Timeline>
          <p v-if="failedCollectionStages(currentState).length" class="ph-empty-copy">
            重试只执行未成功阶段；已成功的详情、分析和入库结果会复用。
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
              currentState?.stages?.analysis?.status === 'running'
                ? 'AI 正在生成判断。'
                : currentState?.stages?.analysis?.status === 'skipped'
                  ? '采集时未启用 AI，本岗位没有匹配结论。'
                  : '此岗位尚无有效 AI 结论，请查看上方分析阶段。'
            }}
          </p>
        </section>

        <section v-if="currentJob" class="ph-section" aria-labelledby="status-title">
          <div>
            <h2 id="status-title">独立投递</h2>
          </div>
          <div class="ph-status-tags">
            <Tag :value="deliveryStage.label" :severity="deliveryStage.severity" />
            <Button
              v-if="!['unknown', 'running', 'succeeded'].includes(deliveryStage.status)"
              label="投递该岗位…"
              severity="secondary"
              outlined
              size="small"
              :disabled="!!deliveryReason"
              @click="openDelivery"
            />
          </div>
          <Message v-if="deliveryStage.status === 'unknown'" severity="warn" :closable="false"
            >{{ deliveryReason }}。<a :href="currentJob.link" target="_blank" rel="noreferrer"
              >打开 BOSS 岗位</a
            ></Message
          >
          <p v-else-if="deliveryReason" class="ph-empty-copy">{{ deliveryReason }}</p>
          <p v-else class="ph-empty-copy">投递将向此岗位招聘者发起沟通；点击后还需确认。</p>
          <p v-if="deliveryStage.message" class="ph-stage-message">{{ deliveryStage.message }}</p>
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
              <strong>{{ safeStageMessage(log.title) }}</strong>
              <p>{{ safeStageMessage(log.message || log.state_name) }}</p>
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
        <span>当前页 {{ pageJobs.length }} 个岗位</span>
        <span
          >今日已投递 {{ helper.statistics.todayData.value.success }}/{{
            conf.formData.deliveryLimit.value
          }}</span
        >
      </div>
      <div class="ph-actions">
        <Button
          :label="helper.workflow?.status.value === 'stop' ? '继续采集' : '开始采集'"
          icon="pi pi-play"
          :loading="isBusy"
          :disabled="!canStart || isBusy"
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
      </div>
      <div class="ph-footer-secondary">
        <span class="ph-count">暂停后，已发出的请求可能仍需等待返回。</span>
        <Button
          v-tooltip.top="'仅重置旧顶层等待状态，保留成功阶段；不会清空记录或重新分析。'"
          label="重置等待状态"
          aria-label="重置等待状态，保留成功阶段，不重新分析"
          severity="secondary"
          text
          size="small"
          :disabled="!canReset || isBusy"
          @click="resetProcessing"
        />
      </div>
    </footer>
    <Dialog
      v-model:visible="deliveryDialog"
      modal
      header="确认投递该岗位"
      class="ph-delivery-dialog"
      :style="{ width: 'min(32rem, calc(100vw - 2rem))' }"
      @hide="deliveryKey = null"
    >
      <template v-if="deliveryTarget">
        <h3>{{ deliveryTarget.jobData.jobName || deliveryTarget.jobData.positionName }}</h3>
        <p>{{ deliveryTarget.jobData.brand.name }}</p>
        <p>AI 决策：{{ deliveryTarget.state.aiMatchResult?.decision }}</p>
        <Message severity="warn" :closable="false"
          >确认后将向该岗位招聘者发送沟通请求。这不是仅保存岗位，也不会批量投递其他岗位。</Message
        >
        <p>仍需通过岗位过滤与今日投递上限检查；请求提交不等于投递成功。</p>
      </template>
      <Message v-if="confirmReason" severity="warn" :closable="false">{{ confirmReason }}</Message>
      <template #footer>
        <Button label="取消" severity="secondary" text @click="deliveryDialog = false" />
        <Button
          label="确认投递"
          :disabled="!!confirmReason"
          :loading="requesting"
          @click="confirmDelivery"
        />
      </template>
    </Dialog>
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

.ph-session-summary,
.ph-record-stages,
.ph-footer-secondary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}
.ph-session-summary {
  margin-top: 1rem;
  font-size: 0.875rem;
}
.ph-footer-secondary {
  justify-content: space-between;
  margin-top: 0.5rem;
}
.ph-footer-secondary > span {
  flex: 1;
  min-width: 10rem;
}
.ph-result-list .ph-record {
  align-items: flex-start;
  flex-direction: column;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--p-content-border-color);
}
.ph-record-company {
  color: var(--p-text-muted-color);
  font-size: 0.8125rem;
}
.ph-record-stages {
  gap: 0.375rem;
}
.ph-stages {
  margin-top: 1rem;
}
.ph-stage-name {
  font-size: 0.8125rem;
}
.ph-stage-content {
  display: grid;
  justify-items: start;
  gap: 0.5rem;
  padding-bottom: 1rem;
  min-width: 0;
}
.ph-stage-content > .p-accordion {
  width: 100%;
}
.ph-stage-message {
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.ph-job-detail .ph-status-tags {
  margin-top: 0.75rem;
}

@media (max-width: 899px) {
  .ph-record-stages {
    display: none;
  }
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
