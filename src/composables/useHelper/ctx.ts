import { extendRef } from '@vueuse/core'
import type { Reactive } from 'vue'
import { ref } from 'vue'

import { useConf } from '@/composables/conf'
import type { DeliveryWorkflow } from '@/composables/useApplying'
import type { BossHelperError } from '@/composables/useApplying/deliverError'
import type { TaskResult, WorkflowData } from '@/composables/useApplying/type'
import { useModel } from '@/composables/useModel'
import { ChatModel } from '@/composables/useModel'
import type { AppToastMessage } from '@/services/appToast'
import { useAppToast } from '@/services/appToast'
import { summarizeCollection } from '@/services/collectionStages'
import type { CollectionState } from '@/services/collectionStages'
import type { GreetingSendRequest } from '@/services/greetingSend'

import type { Log, JobData, LogData, ConfigAccordionItem, AlertItem } from './type'

export abstract class HelperContext<C extends HelperContext<C, T, S>, T, S> {
  conf: ReturnType<typeof useConf>
  models: ReturnType<typeof useModel>
  statistics: ReturnType<typeof useStatistics>

  chatModel: ChatModel
  workflow: DeliveryWorkflow<C, T, S> | null = null
  actionRunning = ref(false)
  pageConnection = ref<
    'connecting' | 'reading' | 'ready' | 'reconnecting' | 'empty' | 'error' | 'unavailable'
  >('ready')
  workflowRunning = computed(
    () => this.actionRunning.value || this.workflow?.status.value === 'running',
  )
  collectionSummary = computed(() =>
    summarizeCollection([...this.jobMaps.values()].map((data) => data.state as CollectionState)),
  )
  jobResultMaps: Reactive<Map<string, TaskResult>>

  abstract jobList: Ref<JobData[]>
  abstract jobMaps: Map<string, WorkflowData<T, S>>

  currentJob: Ref<string | null>
  _logs: Ref<Log[]>
  logs: {
    add: (job: JobData, err?: BossHelperError, logdata?: LogData, msg?: string) => void
    info: (title: string, message: string) => void
    clear: () => void
    value: Log[]
  }
  constructor() {
    this.conf = useConf()
    this.models = useModel()
    this.statistics = useStatistics()
    this.currentJob = ref(null)
    this._logs = ref([])
    this.logs = extendRef(this._logs, {
      add: (job: JobData, err?: BossHelperError, logdata?: LogData, msg?: string) => {
        const state = !err ? 'success' : err.state
        const message = msg ?? (err ? err.message : undefined)
        this._logs.value.push({
          job,
          title: job.jobName,
          state,
          state_name: err?.name ?? '投递成功',
          message,
          data: logdata,
        })
      },
      info: (title: string, message: string) => {
        this._logs.value.push({
          title,
          state: 'info',
          state_name: '消息',
          message,
          data: undefined,
        })
      },
      clear: () => {
        this._logs.value = []
      },
    })

    this.chatModel = new ChatModel(this)

    this.jobResultMaps = reactive(new Map())
  }

  abstract loadMoreJob(delay: Promise<any>): Promise<boolean>
  abstract onMount(): Promise<void>
  abstract getConfigItems(): ComputedRef<[AlertItem[], (ConfigAccordionItem | false)[]]>

  abstract start(): Promise<void>
  async retryJob(_key: string): Promise<void> {
    throw new Error('当前来源不支持重试单个岗位')
  }
  async refreshProgress(_key: string): Promise<void> {
    throw new Error('当前来源不支持回读求职进度')
  }
  async deliverJob(_key: string): Promise<void> {
    throw new Error('当前来源不支持独立投递')
  }
  async sendGreeting(_key: string, _request: GreetingSendRequest): Promise<void> {
    throw new Error('当前来源不支持发送招呼语')
  }
  abstract get uid(): string
  abstract get userInfo(): {
    id: string
    name: string
    avatar: string
  }
  abstract get key(): string
  abstract get label(): string

  stop() {
    this.workflow?.stop()
  }
  reset() {
    this.workflow?.reset()
  }
  async notification(
    msg: string,
    opt?: {
      notification?: typeof notification extends (
        message: string,
        options?: infer O,
      ) => Promise<any>
        ? O
        : never
      toast: Partial<AppToastMessage>
    },
  ) {
    const toast = useAppToast()
    if (this.conf.formData.notification.value && document.visibilityState !== 'visible') {
      await notification(msg, opt?.notification)
    }
    toast.add({
      ...opt?.toast,
      title: msg,
    })
  }

  async onJobCardClick(_key: string) {
    throw new Error('Method not implemented.')
  }
}
