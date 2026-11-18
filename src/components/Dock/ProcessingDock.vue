<script lang="ts" setup>
import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import ProgressBar from 'primevue/progressbar'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import Tabs from 'primevue/tabs'
import Tag from 'primevue/tag'
import Timeline from 'primevue/timeline'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, ref, watch } from 'vue'

import GreetingDraft from '@/components/AI/GreetingDraft.vue'
import Resume from '@/components/AI/JobMatchingSettings.vue'
import Ai from '@/components/Tabs/AI.vue'
import Config from '@/components/Tabs/Config.vue'
import Feishu from '@/components/Tabs/Feishu.vue'
import { saveSettingsPatch, useConf } from '@/composables/conf'
import { useHelper } from '@/composables/useHelper'
import type { BossWorkflowState } from '@/entrypoints/boss/delivery'
import {
  collectionKeys,
  collectionLabel,
  collectionProgress,
  failedCollectionStages,
  safeStageMessage,
  stageView,
} from '@/utils/collectionView'
import { hasResumeContent } from '@/utils/workbenchState'

import '@/assets/prime-workspace.css'

const helper = useHelper()
const conf = useConf()
const activeView = ref<'workspace' | 'settings'>('workspace')
const settingsTab = ref('automation')
const requesting = ref(false)
const launchRequested = ref(false)
const cancelling = ref(false)
const savingAiToggle = ref(false)
const isRunning = computed(() => !!helper.workflowRunning.value)
const operationActive = computed(
  () =>
    isRunning.value ||
    requesting.value ||
    launchRequested.value ||
    [...helper.jobMaps.values()].some((record) =>
      collectionKeys.some(
        (key) => (record.state as BossWorkflowState).stages?.[key]?.status === 'running',
      ),
    ),
)
const isBusy = computed(() => operationActive.value || cancelling.value || savingAiToggle.value)
const actionError = ref('')
const sessionJobs = computed(() => [...helper.jobMaps.values()].map((record) => record.jobData))
const summary = computed(() => helper.collectionSummary.value)
const progress = computed(() =>
  collectionProgress(
    [...helper.jobMaps.values()].map((record) => record.state as BossWorkflowState),
  ),
)
const progressHint = computed(
  () =>
    `本次已处理 ${progress.value.completed}/${progress.value.total} 个岗位，飞书已有并跳过 ${[...helper.jobMaps.values()].filter((record) => (record.state as BossWorkflowState).skippedExisting).length} 个。以当前已发现岗位为范围，继续加载时总数会更新；失败不计为完成。`,
)
const failedJobs = computed(
  () => sessionJobs.value.filter((job) => failedCollectionStages(stateFor(job.key)).length).length,
)
const displayedJobKey = computed(() => helper.currentJob.value ?? sessionJobs.value[0]?.key)
const workflowError = computed(() => safeStageMessage(helper.workflow?.errorMessage.value))
watch(
  () => [helper.workflow?.status.value, workflowError.value],
  () => {
    if (helper.workflow?.status.value !== 'pending' || workflowError.value)
      launchRequested.value = false
  },
)
watch([operationActive, workflowError], () => {
  if (!operationActive.value || workflowError.value) cancelling.value = false
})
function toggleCollection() {
  if (cancelling.value) return
  if (operationActive.value) {
    cancelling.value = true
    helper.stop()
  } else {
    void startProcessing()
  }
}
const pageJobs = computed(() => helper.jobList.value)
const connectionBusy = computed(() =>
  ['connecting', 'reading', 'reconnecting'].includes(helper.pageConnection.value),
)
const connectionCopy = computed(
  () =>
    ({
      connecting: '正在连接 BOSS 页面，请稍等…',
      reading: '已连接，正在读取岗位列表…',
      reconnecting: '正在重新连接，已有岗位记录会保留…',
      empty: '暂未读取到岗位，可以试试滚动页面或调整 BOSS 筛选条件。',
      error: '暂时连接不上 BOSS 页面，正在自动重试；若持续如此，请刷新 BOSS 页面。',
      unavailable: '请先切换到 BOSS 岗位列表页，这里会自动连接。',
      ready: `已读取 ${pageJobs.value.length} 个岗位，随页面加载更新`,
    })[helper.pageConnection.value],
)
const readiness = computed(() => {
  const model = helper.models.modelData.value.find(
    (item) => item.key === conf.formData.aiFiltering.model,
  )?.data
  const resumeReady = hasResumeContent(conf.formData.resumeMarkdown.content)
  const feishu = conf.formData.feishu
  return [
    {
      label: connectionCopy.value,
      ready:
        !!helper.workflow && helper.pageConnection.value === 'ready' && pageJobs.value.length > 0,
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
const canReset = computed(
  () =>
    !!helper.workflow && helper.pageConnection.value === 'ready' && helper.jobResultMaps.size > 0,
)
const policyCopy = computed(
  () =>
    `${conf.formData.aiFiltering.enable ? '采集并执行 AI 简历匹配' : '采集岗位信息'}；${conf.formData.feishu.enable ? '同步飞书' : '不同步飞书'}。采集范围随 BOSS 搜索和筛选更新。`,
)
async function setAiAnalysis(enabled: boolean) {
  if (isBusy.value) return
  savingAiToggle.value = true
  actionError.value = ''
  try {
    await saveSettingsPatch({ aiFiltering: { ...conf.formData.aiFiltering, enable: enabled } })
  } catch {
    actionError.value = 'AI 自动分析开关保存失败，请重试。'
  } finally {
    savingAiToggle.value = false
  }
}
function openSettings(tab: string) {
  checkDialog.value = false
  settingsTab.value = tab
  activeView.value = 'settings'
}
async function startProcessing() {
  if (!canStart.value || isBusy.value) return
  await requestAction(async () => {
    launchRequested.value = true
    try {
      await helper.start()
      if (helper.workflow?.status.value !== 'pending' || workflowError.value)
        launchRequested.value = false
    } catch (error) {
      launchRequested.value = false
      throw error
    }
  })
}

async function requestAction(action: () => Promise<void>) {
  if (isBusy.value) return
  requesting.value = true
  actionError.value = ''
  try {
    await action()
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
    helper.pageConnection.value === 'ready' &&
    !collectionKeys.some((stage) =>
      ['running', 'unknown'].includes(state?.stages?.[stage]?.status ?? 'pending'),
    )
  )
}
async function retryJob(key: string) {
  if (!canRetryJob(key)) return
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
function jobStatusLabel(key: string) {
  return collectionLabel(stateFor(key))
}
function stateFor(key: string) {
  return helper.jobMaps.get(key)?.state as BossWorkflowState | undefined
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
const recentLogs = computed(() => helper.logs.value.slice(-20).reverse())
const workflowLabel = computed(() =>
  connectionBusy.value
    ? '正在同步'
    : isBusy.value
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
const checkDialog = ref(false)
const checkRows = ref<Array<{ label: string; ready: boolean; tab: string }>>([])
function runCheck() {
  // Check the currently saved local configuration; this is not a network probe.
  checkRows.value = readiness.value.map((item) => ({ ...item }))
  checkDialog.value = true
}
const recordsDialog = ref(false)
const detailsDialog = ref(false)
const logsDialog = ref(false)
const infoDialog = ref(false)
const inspectedKey = ref<string>()
const inspected = computed(() =>
  inspectedKey.value ? helper.jobMaps.get(inspectedKey.value) : undefined,
)
const inspectedState = computed(() => inspected.value?.state as BossWorkflowState | undefined)
const inspectedMatch = computed(() => inspectedState.value?.aiMatchResult)
const inspectedStages = computed(() =>
  collectionKeys.map((key) => stageView(key, inspectedState.value)),
)
function showDetails(key?: string) {
  if (!key) return
  inspectedKey.value = key
  recordsDialog.value = false
  detailsDialog.value = true
}
const stageShortName = { detail: '详情获取', analysis: 'AI 分析', storage: '飞书入库' }
const stageShortLabel = (item: ReturnType<typeof stageView>) =>
  item.status === 'succeeded' ? '已完成' : item.label
const currentFailed = computed(() => failedCollectionStages(currentState.value).length > 0)
const dialogStyle = { width: 'min(36rem, calc(100vw - 2rem))' }
</script>
<template>
  <div class="ph-shell">
    <header class="ph-header cw-header">
      <div class="ph-heading">
        <div class="ph-product-mark" aria-hidden="true">B</div>
        <h1>{{ activeView === 'settings' ? '设置' : '岗位工作台' }}</h1>
      </div>
      <div class="ph-header-actions">
        <Button
          v-if="activeView === 'workspace'"
          v-tooltip.bottom="policyCopy"
          icon="pi pi-info-circle"
          severity="secondary"
          text
          rounded
          aria-label="查看运行说明"
          @click="infoDialog = true"
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

    <main v-show="activeView === 'workspace'" class="cw-content">
      <section class="cw-section" aria-label="运行概况">
        <div class="cw-row">
          <Tag
            :value="workflowLabel"
            :severity="isBusy || connectionBusy ? 'info' : 'secondary'"
            :icon="isBusy || connectionBusy ? 'pi pi-spin pi-spinner' : 'pi pi-circle-fill'"
          />
          <Button
            label="检查配置"
            icon="pi pi-check-circle"
            size="small"
            text
            severity="secondary"
            @click="runCheck"
          />
        </div>
        <div class="cw-row">
          <label for="collection-ai-analysis">AI 自动分析</label>
          <ToggleSwitch
            input-id="collection-ai-analysis"
            :model-value="conf.formData.aiFiltering.enable"
            :disabled="isBusy"
            @update:model-value="setAiAnalysis"
          />
        </div>
        <p v-if="helper.pageConnection.value !== 'ready'" class="cw-connection" role="status">
          {{ connectionCopy }}
        </p>
        <Button
          v-else-if="!canStart && !isBusy"
          label="有配置待完善，点击检查"
          icon="pi pi-exclamation-circle"
          severity="warn"
          text
          size="small"
          @click="runCheck"
        />
        <div class="cw-metrics" aria-label="本次会话汇总">
          <div>
            <strong>{{ summary.total }}</strong
            ><span>已发现</span>
          </div>
          <div>
            <strong>{{ summary.stages.detail.succeeded }}</strong
            ><span>详情完成</span>
          </div>
          <div>
            <strong>{{ summary.stages.analysis.succeeded }}</strong
            ><span>分析完成</span>
          </div>
          <div>
            <strong>{{ summary.stages.storage.succeeded }}</strong
            ><span>已入库</span>
          </div>
        </div>
        <div v-if="workflowError || actionError" class="cw-error" role="alert">
          <p class="cw-clamp">{{ workflowError || actionError }}</p>
          <Button label="查看问题" severity="danger" text size="small" @click="logsDialog = true" />
        </div>
      </section>

      <section class="cw-section cw-current" aria-labelledby="current-title">
        <div class="cw-row">
          <h2 id="current-title">
            {{ helper.currentJob.value ? '当前岗位' : currentJob ? '待处理岗位' : '等待岗位' }}
          </h2>
          <Button
            v-if="currentJob"
            label="详情"
            icon="pi pi-angle-right"
            size="small"
            text
            severity="secondary"
            @click="showDetails(currentJob.key)"
          />
        </div>
        <template v-if="currentJob">
          <a
            :href="currentJob.link"
            target="_blank"
            rel="noreferrer"
            class="cw-job-name"
            v-tooltip.top="currentJob.jobName || currentJob.positionName"
            >{{ currentJob.jobName || currentJob.positionName }}</a
          >
          <p class="cw-meta" v-tooltip.top="currentJob.brand.name">{{ currentJob.brand.name }}</p>
        </template>
        <p v-else class="cw-muted">
          {{
            connectionBusy
              ? '页面就绪后，岗位会自动出现在这里。'
              : '在 BOSS 列表页选择搜索条件，然后开始采集。'
          }}
        </p>

        <Timeline
          :value="currentStages"
          layout="horizontal"
          align="top"
          class="cw-stages"
          aria-label="采集阶段"
          :pt="{
            event: { style: 'flex: 1; min-width: 0' },
            eventOpposite: { style: 'display: none' },
            eventContent: { style: 'min-width: 0; padding: 0.5rem 0.25rem 0 0' },
          }"
        >
          <template #content="{ item }">
            <div class="cw-stage">
              <span>{{ stageShortName[item.key as keyof typeof stageShortName] }}</span>
              <Tag
                :value="stageShortLabel(item)"
                :severity="item.severity"
                :icon="item.status === 'running' ? 'pi pi-spin pi-spinner' : undefined"
              />
            </div>
          </template>
        </Timeline>
        <div v-if="currentFailed && currentJob" class="cw-row cw-failure">
          <Button
            label="查看失败原因"
            icon="pi pi-exclamation-circle"
            severity="danger"
            text
            size="small"
            @click="showDetails(currentJob.key)"
          />
          <Button
            label="重试该岗位"
            severity="secondary"
            outlined
            size="small"
            :disabled="!canRetryJob(currentJob.key)"
            @click="retryJob(currentJob.key)"
          />
        </div>

        <div v-if="match" class="cw-ai">
          <Tag :value="decisionLabel" :severity="decisionSeverity" />
        </div>
      </section>

      <nav class="cw-secondary" aria-label="更多记录">
        <Button
          :label="`记录 ${sessionJobs.length}`"
          icon="pi pi-list"
          severity="secondary"
          text
          size="small"
          @click="recordsDialog = true"
        />
        <Button
          v-if="failedJobs"
          :label="`${failedJobs} 个失败`"
          severity="warn"
          text
          size="small"
          @click="recordsDialog = true"
        />
        <Button
          label="运行日志"
          icon="pi pi-history"
          severity="secondary"
          text
          size="small"
          @click="logsDialog = true"
        />
      </nav>
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

    <footer v-if="activeView === 'workspace'" class="cw-footer">
      <ProgressBar
        v-tooltip.top="progressHint"
        :value="progress.value"
        :show-value="false"
        aria-label="本次采集完成进度"
        :aria-valuetext="progressHint"
      />
      <div class="ph-actions">
        <Button
          :label="
            cancelling
              ? '正在取消…'
              : operationActive
                ? '取消采集'
                : helper.workflow?.status.value === 'stop'
                  ? '继续采集'
                  : '开始采集'
          "
          :icon="operationActive ? 'pi pi-stop' : 'pi pi-play'"
          :loading="cancelling"
          :disabled="cancelling || (!operationActive && !canStart)"
          fluid
          @click="toggleCollection"
        />
      </div>
    </footer>

    <Dialog v-model:visible="checkDialog" modal header="配置检查" :style="dialogStyle">
      <p class="cw-muted">
        检查当前已保存配置，不调用模型、不写入飞书；配置完整不代表远端服务已连通。
      </p>
      <ul class="cw-check-list">
        <li v-for="item in checkRows" :key="item.tab">
          <i
            :class="
              item.ready
                ? 'pi pi-check-circle'
                : !item.tab && connectionBusy
                  ? 'pi pi-spin pi-spinner'
                  : 'pi pi-exclamation-circle'
            "
            aria-hidden="true"
          />
          <span>{{ item.label }}</span>
          <Button
            v-if="!item.ready && item.tab"
            label="去设置"
            text
            size="small"
            @click="openSettings(item.tab)"
          />
        </li>
      </ul>
      <template #footer>
        <Button label="重新检查" severity="secondary" text @click="runCheck" />
        <Button label="知道了" @click="checkDialog = false" />
      </template>
    </Dialog>

    <Dialog v-model:visible="recordsDialog" modal header="本次会话记录" :style="dialogStyle">
      <p class="cw-muted">
        只保留当前 BOSS 页面会话，刷新页面后清空。查看历史记录不会切换正在处理的岗位。
      </p>
      <DataTable
        :value="sessionJobs"
        dataKey="key"
        paginator
        :rows="6"
        size="small"
        paginatorTemplate="PrevPageLink CurrentPageReport NextPageLink"
        currentPageReportTemplate="{currentPage} / {totalPages}"
      >
        <Column header="岗位">
          <template #body="{ data }">
            <Button
              :label="data.jobName || data.positionName"
              severity="secondary"
              text
              size="small"
              @click="showDetails(data.key)"
            />
            <p class="cw-muted">{{ data.brand.name }}</p>
            <Tag
              :value="jobStatusLabel(data.key)"
              :severity="failedCollectionStages(stateFor(data.key)).length ? 'danger' : 'secondary'"
            />
            <span class="cw-muted"> {{ decisionFor(data.key) }}</span>
          </template>
        </Column>
        <Column header="操作">
          <template #body="{ data }">
            <Button
              v-if="failedCollectionStages(stateFor(data.key)).length"
              label="重试"
              size="small"
              severity="secondary"
              :disabled="!canRetryJob(data.key)"
              @click="retryJob(data.key)"
            />
            <Button v-else label="查看" size="small" text @click="showDetails(data.key)" />
          </template>
        </Column>
        <template #empty>本次会话尚无岗位记录。</template>
      </DataTable>
    </Dialog>

    <Dialog v-model:visible="detailsDialog" modal header="岗位处理详情" :style="dialogStyle">
      <template v-if="inspected">
        <h3 class="cw-detail-title">
          {{ inspected.jobData.jobName || inspected.jobData.positionName }}
        </h3>
        <p class="cw-muted">
          {{ inspected.jobData.brand.name }} · {{ inspected.jobData.salary || '薪资待确认' }}
        </p>
        <div v-if="conf.formData.feishu.enable" class="cw-row">
          <Tag
            :value="inspectedState?.feishuRecord?.applicationProgress || '尚未回读进度'"
            severity="secondary"
          />
          <Button
            label="回读进度"
            severity="secondary"
            text
            size="small"
            :disabled="isBusy"
            @click="requestAction(() => helper.refreshProgress(inspected!.jobData.key))"
          />
        </div>
        <div v-for="stage in inspectedStages" :key="stage.key" class="cw-detail-stage">
          <div class="cw-row">
            <strong>{{ stage.name }}</strong
            ><Tag :value="stage.label" :severity="stage.severity" />
          </div>
          <p class="cw-muted">尝试 {{ stage.attempts }} 次</p>
          <p v-if="stage.message" class="cw-message">{{ stage.message }}</p>
        </div>
        <template v-if="inspectedMatch">
          <h3>AI 分析</h3>
          <p>{{ inspectedMatch.reason }}</p>
          <template
            v-for="group in [
              { title: '匹配点', items: inspectedMatch.matchPoints },
              { title: '缺口', items: inspectedMatch.gaps },
              { title: '待核实', items: inspectedMatch.uncertainties },
            ]"
            :key="group.title"
          >
            <h4 v-if="group.items.length">{{ group.title }}</h4>
            <ul v-if="group.items.length">
              <li v-for="item in group.items" :key="item">{{ item }}</li>
            </ul>
          </template>
        </template>
        <p v-else class="cw-muted">
          {{
            inspectedState?.skippedExisting
              ? '飞书已有，本次跳过详情采集与 AI 分析。'
              : inspectedState?.stages?.analysis?.status === 'skipped'
                ? '本岗位采集时未启用 AI。'
                : '本岗位尚无 AI 结论。'
          }}
        </p>
      </template>
      <p v-else>该岗位已不在当前会话中。</p>
      <GreetingDraft
        v-if="inspected"
        :key="inspected.jobData.key"
        :job="inspected.jobData"
        :busy="isBusy"
      />
      <template #footer>
        <Button
          v-if="inspectedKey"
          :label="failedCollectionStages(inspectedState).length ? '重试该岗位' : '更新分析与入库'"
          :disabled="!canRetryJob(inspectedKey)"
          severity="secondary"
          @click="retryJob(inspectedKey)"
        />
        <Button label="关闭" @click="detailsDialog = false" />
      </template>
    </Dialog>

    <Dialog v-model:visible="logsDialog" modal header="运行日志" :style="dialogStyle">
      <Message v-if="workflowError || actionError" severity="error" :closable="false">{{
        workflowError || actionError
      }}</Message>
      <p class="cw-muted">
        请求提交不等于处理完成，以各阶段结果为准。暂停后，已发出的请求可能仍需等待返回。
      </p>
      <ol v-if="recentLogs.length" class="cw-log-list">
        <li v-for="(log, index) in recentLogs" :key="index">
          <strong>{{ safeStageMessage(log.title) }}</strong>
          <p class="cw-message">{{ safeStageMessage(log.message || log.state_name) }}</p>
        </li>
      </ol>
      <p v-else class="cw-muted">暂无运行记录。</p>
      <template #footer>
        <Button
          v-tooltip.top="'保留成功阶段，不清空记录或重新分析。'"
          label="重置等待状态"
          severity="secondary"
          text
          :disabled="!canReset || isBusy"
          @click="resetProcessing"
        />
        <Button label="关闭" @click="logsDialog = false" />
      </template>
    </Dialog>

    <Dialog v-model:visible="infoDialog" modal header="运行说明" :style="dialogStyle">
      <p>{{ policyCopy }}</p>
      <p>岗位详情、AI 分析和飞书入库独立记录状态。关闭 AI 或飞书时，对应阶段显示“未启用”。</p>
      <p>记录只保留在当前 BOSS 页面会话中；刷新该页面后不会恢复。重试会复用已成功阶段。</p>
      <p>如需手动投递，请在 BOSS 原页面操作。</p>
      <template #footer><Button label="知道了" @click="infoDialog = false" /></template>
    </Dialog>
  </div>
</template>

<style scoped>
.cw-header {
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
}
.cw-content {
  min-height: 0;
  overflow: auto;
  padding: 0 1rem;
}
.cw-section {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--p-content-border-color);
}
.cw-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
}
.cw-row h2 {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
}
.cw-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.cw-metrics > div {
  display: grid;
  gap: 0.25rem;
}
.cw-metrics strong {
  font-size: 1.125rem;
  font-variant-numeric: tabular-nums;
}
.cw-metrics span,
.cw-muted,
.cw-meta {
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
  line-height: 1.5;
}
.cw-connection {
  font-size: 0.8125rem;
  line-height: 1.5;
  margin: 0.5rem 0 0;
}
.cw-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  color: var(--p-red-600);
}
.cw-error p {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
}
.cw-clamp,
.cw-job-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.cw-job-name {
  color: var(--p-text-color);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
  text-decoration: none;
  margin: 0.5rem 0 0.25rem;
}
.cw-job-name:hover {
  text-decoration: underline;
}
.cw-meta {
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cw-stages {
  margin-top: 1rem;
}
.cw-stage {
  display: grid;
  justify-items: start;
  gap: 0.5rem;
}
.cw-stage > span {
  font-size: 0.8125rem;
}
.cw-failure {
  margin-top: 0.5rem;
}
.cw-ai {
  margin-top: 0.75rem;
}
.cw-secondary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.5rem 0;
}
.cw-footer {
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--p-content-border-color);
}
.cw-footer .ph-actions {
  margin-top: 0.5rem;
}
.cw-check-list,
.cw-log-list {
  padding: 0;
  list-style: none;
}
.cw-check-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0;
}
.cw-check-list li > span {
  flex: 1;
  min-width: 0;
}
.cw-detail-title,
.cw-message {
  overflow-wrap: anywhere;
}
.cw-message {
  white-space: pre-wrap;
  font-size: 0.875rem;
  line-height: 1.5;
}
.cw-detail-stage,
.cw-log-list li {
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--p-content-border-color);
}
.cw-detail-stage p {
  margin: 0.5rem 0 0;
}
</style>
