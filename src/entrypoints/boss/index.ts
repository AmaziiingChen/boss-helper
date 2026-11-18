import { ref } from 'vue'

import { defineUnlistedScript } from '#imports'
import { useConf } from '@/composables/conf'
import type { WorkflowData } from '@/composables/useApplying/type'
import { createLazyObject, isInitialized } from '@/composables/useApplying/type'
import type { JobData } from '@/composables/useHelper'
import { HelperContext } from '@/composables/useHelper'
import type { AlertItem, ConfigAccordionItem } from '@/composables/useHelper/type'
import { getRootVue, useHookVueData, useHookVueFn } from '@/composables/useVue'
import { run } from '@/index'
import { initCounter } from '@/message'
import { providePageWorkflow } from '@/message/workflowBridge'
import { useAppToast } from '@/services/appToast'
import { collectionInputKeys, synchronizeCollectionInputs } from '@/services/collectionInputs'
import type { CollectionInputKeys } from '@/services/collectionInputs'
import { readJobFromFeishu } from '@/services/feishu'
import type { GreetingSendRequest } from '@/services/greetingSend'
import { shouldDeliverJob } from '@/services/jobMatching'
import { logger } from '@/utils/logger'

import type { BoosJobData, BossWorkflowState } from './delivery'
import { bossWorkflow, bossDeliveryWorkflow } from './delivery'
import {
  applyBossDetail,
  bossAccessBlockReason,
  refreshBossListJob,
  waitForBossDetail,
  waitForBossListChange,
} from './detailState'
import { sendGreetingForJob } from './greetingSend'
import type { BossZpDetailData, BossZpJobItemData } from './types'

const initChange = useHookVueFn('#wrap .page-job-wrapper', 'pageChangeAction')
const initSearch = useHookVueFn('#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main', [
  'searchJobAction',
  'onSearch',
])

function formatActiveTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const day = 24 * 60 * 60 * 1000

  if (diff < day) return '今日活跃'
  if (diff < 2 * day) return '昨日活跃'
  if (diff < 7 * day) return '本周活跃'
  if (diff < 30 * day) return '本月活跃'
  return '较久未活跃'
}

function convertBossZpJobItemToJobData(item: BossZpJobItemData): JobData {
  const key = `boss::${item.encryptJobId}`

  return {
    key,
    link: `https://www.zhipin.com/job_detail/${item.encryptJobId}.html`,
    jobName: item.jobName,
    positionName: item.jobName,
    jobDescription: '',

    // 经验和学历要求 - 从 jobLabels 中解析或直接使用
    experienceName: item.jobExperience || item.jobLabels?.[0] || '经验不限',
    degreeName: item.jobDegree || '学历不限',
    salary: item.salaryDesc,

    // 地址相关
    address: [item.cityName, item.areaDistrict, item.businessDistrict].filter(Boolean).join('-'),
    addressCoords: item.gps ? [item.gps.longitude, item.gps.latitude] : undefined,

    // 技能标签
    showSkills: item.skills || [],
    jobLabels: item.jobLabels || [],
    skills: item.skills || [],

    // 活跃时间 - 从 lastModifyTime 获取
    activeTime: item.lastModifyTime,
    activeTimeStr: item.lastModifyTime ? formatActiveTime(item.lastModifyTime) : undefined,

    // 福利
    welfareList: item.welfareList,

    // 招聘者信息
    boss: {
      link: `https://www.zhipin.com/boss_detail/${item.encryptBossId}.html`,
      name: item.bossName,
      title: item.bossTitle,
      avatar: item.bossAvatar,
      certificated: item.bossCert > 0,
      isHeadhunter: item.goldHunter === 1,
      isFriend: false,
      isOnline: item.bossOnline ?? false,
    },

    // 公司品牌信息
    brand: {
      link: `https://www.zhipin.com/gongsi/${item.encryptBrandId}.html`,
      name: item.brandName,
      logo: item.brandLogo,
      scale: item.brandScaleName,
      industry: item.brandIndustry,
      stageName: item.brandStageName,
      introduce: '',
      labels: [],
    },

    // 状态信息
    // status: {
    //   status: item.contact ? 'warn' : 'pending',
    //   msg: item.contact ? '已沟通' : '未开始',
    // },
  }
}

export class BossHelperCtx extends HelperContext<BossHelperCtx, BoosJobData, BossWorkflowState> {
  private legacyBindingsPromise: Promise<void> | null = null
  private nextBindingRetryAt = 0
  private activeInputKeys?: CollectionInputKeys
  label = 'Boss直聘'
  key = 'boss'

  _page = ref({ page: 1, pageSize: 15 })
  _pageHasMore = ref(true)
  _jobDetail = ref<BossZpDetailData>()
  _pageChange = (_v: number) => {
    throw new Error('pageChange is undefined')
  }
  _clickJobCardAction: (item: BossZpJobItemData) => void = () => {}
  _jobList: Ref<BossZpJobItemData[]>
  _jobDataMap: Map<string, BoosJobData>

  rootVue: any = null
  jobMaps: Map<string, WorkflowData<BoosJobData, BossWorkflowState>>
  jobList: Ref<JobData[]>

  constructor() {
    const jobList = ref<JobData[]>([])
    const _jobList = ref<BossZpJobItemData[]>([])
    const _jobListMap = new Map<string, BoosJobData>()

    super()

    this.jobList = jobList
    this._jobList = _jobList
    this._jobDataMap = _jobListMap

    this.jobMaps = reactive(new Map())
  }

  get uid() {
    // return window?.Cookie.get('bst') // token ?
    if (!window._PAGE.encryptUserId) {
      useAppToast().add({
        color: 'error',
        title: '未获取到用户ID，可能会出现奇怪bug, 请尝试刷新页面或反馈',
      })
    }
    return window._PAGE.encryptUserId
  }

  get userInfo() {
    return {
      id: window._PAGE.encryptUserId,
      name: window._PAGE.showName ?? window._PAGE.name,
      avatar: window._PAGE.largeAvatar ?? window._PAGE.tinyAvatar ?? '',
    }
  }

  static async new() {
    const ctx = new BossHelperCtx()
    ctx.workflow = await bossWorkflow(ctx)
    return ctx
  }

  private async initLegacyBindings() {
    if (this.legacyBindingsPromise) return this.legacyBindingsPromise

    this.legacyBindingsPromise = (async () => {
      this.rootVue = await getRootVue()
      await this._initPage()
      await this._initPageChange()
      await this._initJobDetail()
      await this._initClickJobCardAction()
      await this._initJobList()
    })().catch((error) => {
      this.legacyBindingsPromise = null
      throw error
    })

    return this.legacyBindingsPromise
  }

  private async prepareCollectionInputs() {
    const model = this.models.modelData.value.find(
      (item) => item.key === this.conf.formData.aiFiltering.model,
    )
    const keys = await collectionInputKeys(this.conf.formData, model)
    this.activeInputKeys = keys
    for (const [key, data] of this.jobMaps) {
      if (synchronizeCollectionInputs(data.state, keys)) this.jobResultMaps.delete(key)
    }
  }

  async loadMoreJob(delay: Promise<any>): Promise<boolean> {
    try {
      if (this._pageHasMore.value === false) return false
      const previous = this._jobList.value.slice()
      const oldLen = this._jobList.value.length
      const oldFirstJobId = this._jobList.value[0]?.encryptJobId ?? ''

      const blocked = bossAccessBlockReason(document.body?.innerText ?? '')
      if (blocked) throw new Error(blocked)
      this._pageChange(this._page.value.page + 1)
      await delay
      if (this.workflow?.mode === 'collection') {
        return await waitForBossListChange(
          () => this._jobList.value,
          previous,
          () => this.workflow?.status.value === 'stop',
          () => bossAccessBlockReason(document.body?.innerText ?? ''),
        )
      }
      const currentFirstJobId = this._jobList.value[0]?.encryptJobId ?? ''
      if (
        (location.href.includes('/web/geek/job-recommend') ||
          location.href.includes('/web/geek/jobs')) &&
        oldLen === this._jobList.value.length &&
        oldFirstJobId === currentFirstJobId
      ) {
        logger.error('翻页: 内容无变化')
        return false
      }
    } catch (err) {
      logger.error('翻页: 下一页错误', err)
      throw err
    }
    return true
  }

  private startVersion = 0
  private starting = false
  private actionWorkflow: Awaited<ReturnType<typeof bossWorkflow>> | null = null

  override stop() {
    this.startVersion++
    this.actionWorkflow?.stop()
    super.stop()
  }

  override async retryJob(key: string) {
    await this.runSingleJob(key, false)
  }

  override async refreshProgress(key: string) {
    if (this.starting || this.workflowRunning.value)
      throw new Error('请先暂停采集或等待当前操作结束')
    const data = this.jobMaps.get(key)
    if (!data) throw new Error('当前会话中未找到该岗位')
    this.actionRunning.value = true
    try {
      await this.conf.confInit()
      const config = this.conf.formData.feishu
      if (!config.enable) throw new Error('请先启用并保存飞书配置')
      const record = await readJobFromFeishu(data.rawData.jobitem.encryptJobId, config)
      data.state.feishuRecord = record
      data.state.feishuRecordId = record?.recordId
      if (!record) throw new Error('飞书未找到该岗位，请先完成入库')
    } finally {
      this.actionRunning.value = false
    }
  }

  override async deliverJob(key: string) {
    await this.runSingleJob(key, true)
  }

  private async runSingleJob(key: string, delivery: boolean) {
    if (this.starting || this.workflowRunning.value) throw new Error('请先等待当前任务结束或暂停')
    const data = this.jobMaps.get(key)
    if (!data) throw new Error('当前页面会话中未找到该岗位，请先采集')
    if (
      delivery &&
      this.statistics.todayData.value.success >= this.conf.formData.deliveryLimit.value
    ) {
      throw new Error('已达到今日投递上限')
    }
    this.starting = true
    this.actionRunning.value = true
    const version = ++this.startVersion
    try {
      await this.prepareCollectionInputs()
      const workflow = delivery ? await bossDeliveryWorkflow(this) : await bossWorkflow(this, false)
      this.actionWorkflow = workflow
      const ready = await workflow.rebuild()
      if (version !== this.startVersion || !ready) return
      this.currentJob.value = key
      if (this.workflow) this.workflow.status.value = 'running'
      workflow.status.value = 'running'
      await workflow.execute(data)
      if (delivery && !data.state.stages?.delivery) {
        const result = this.jobResultMaps.get(key)
        data.state.stages ??= {}
        data.state.stages.delivery = {
          status: result?.status === 'error' ? 'failed' : 'skipped',
          message: result?.reason ?? result?.msg,
          attempts: 0,
          finishedAt: Date.now(),
        }
      }
    } finally {
      if (this.workflow) {
        this.workflow.status.value =
          this.actionWorkflow?.status.value === 'error'
            ? 'error'
            : version !== this.startVersion
              ? 'stop'
              : 'pending'
        this.workflow.errorMessage.value = this.actionWorkflow?.errorMessage.value ?? null
      }
      this.actionWorkflow = null
      this.actionRunning.value = false
      this.starting = false
    }
  }

  async start() {
    if (this.starting) return
    if (this.workflowRunning.value) return
    this.starting = true
    const version = ++this.startVersion
    try {
      if (this.workflow) this.workflow.status.value = 'running'
      await this.initLegacyBindings()
      if (version !== this.startVersion) return
      await this.prepareCollectionInputs()
      if (version !== this.startVersion) return
      if (!this.workflow) {
        this.workflow = await bossWorkflow(this)
      }
      await this.workflow.executeAll(this._jobDataMap)
    } catch (error) {
      if (this.workflow) {
        this.workflow.status.value = 'error'
        this.workflow.errorMessage.value = error instanceof Error ? error.message : String(error)
      }
      throw error
    } finally {
      this.starting = false
    }
  }

  override async sendGreeting(key: string, request: GreetingSendRequest) {
    if (this.starting || this.workflowRunning.value)
      throw new Error('请先暂停采集或等待当前操作结束')
    const data = this.jobMaps.get(key)
    if (!data || !data.jobData.jobDescription?.trim()) throw new Error('请先采集完整岗位详情')
    this.actionRunning.value = true
    try {
      await this.conf.confInit()
      await this.models.initModel()
      await this.prepareCollectionInputs()
      const match = data.state.aiMatchResult
      if (!match || !shouldDeliverJob(match.decision, true, this.conf.formData.deliverReview.value))
        throw new Error('该岗位尚未通过现有 AI 投递规则，请先完成分析并核对 REVIEW 设置')
      if (this.conf.formData.feishu.enable) {
        const record = await readJobFromFeishu(
          data.rawData.jobitem.encryptJobId,
          this.conf.formData.feishu,
        )
        data.state.feishuRecord = record
        if (!record || record.applicationProgress !== '待处理')
          throw new Error('飞书未找到唯一的“待处理”岗位记录，未发送')
      }
      await sendGreetingForJob(data.rawData.jobitem, data.jobData, request, (record) => {
        data.state.greetingSend = record
      })
    } finally {
      this.actionRunning.value = false
    }
  }

  async onMount() {
    // Native side panel owns the UI. Never insert a workspace into the BOSS page.
    if (Date.now() < this.nextBindingRetryAt) return
    try {
      await this.initLegacyBindings()
    } catch (err) {
      this.nextBindingRetryAt = Date.now() + 5000
      logger.warn('BOSS 页面数据绑定未完成，暂不能读取岗位列表', err)
    }
  }
  getConfigItems() {
    const conf = useConf()
    return computed<[AlertItem[], (ConfigAccordionItem | false)[]]>(() => {
      return [
        [
          {
            type: 'alert',
            id: 'config-alert-1',
            showIcon: true,
            title: '配置只保存在当前浏览器',
            color: 'success',
            description: '处理任务运行时会锁定关键筛选项；修改后需要手动保存才会生效。',
          },
        ],
        [
          {
            label: '筛选配置',
            value: 'filter',
            items: [
              {
                type: 'div',
                class: 'grid grid-cols-1 gap-3 w-full',

                items: [
                  {
                    type: 'select',
                    key: 'company',
                  },
                  {
                    type: 'select',
                    key: 'jobTitle',
                  },
                  {
                    type: 'select',
                    key: 'jobContent',
                  },
                  {
                    type: 'select',
                    key: 'hrPosition',
                  },
                  conf.configLevel.intermediate && {
                    type: 'select',
                    key: 'jobAddress',
                  },
                ],
              },
              {
                type: 'div',
                class: 'col-span-full grid grid-cols-1 gap-2 mt-3',
                items: [
                  conf.configLevel.intermediate && {
                    type: 'checkbox',
                    key: 'activityFilter',
                  },
                  {
                    type: 'checkbox',
                    key: 'goldHunterFilter',
                  },
                  {
                    type: 'checkbox',
                    key: 'friendStatus',
                  },
                  {
                    type: 'checkbox',
                    key: 'bossGoldMedalHr',
                  },
                  conf.configLevel.intermediate && {
                    type: 'checkbox-expire',
                    key: 'sameCompanyFilter',
                  },
                  conf.configLevel.intermediate && {
                    type: 'checkbox-expire',
                    key: 'sameHrFilter',
                  },
                ],
              },
            ],
          },
          {
            label: '地址配置',
            value: 'address',
            items: [{ type: 'address', key: 'address' }],
          },
          {
            label: '延迟配置',
            value: 'delay',
            items: [
              {
                type: 'div',
                class: 'grid grid-cols-1 gap-3',
                items: [
                  {
                    type: 'inputNumber',
                    key: 'delayDeliveryStarts',
                    fieldProps: {
                      label: '投递开始',
                      'data-help': '点击投递按钮会等待一段时间,默认值10s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                      suffix: ' 秒',
                    },
                  },
                  {
                    type: 'inputNumber',
                    key: 'delayDeliveryInterval',
                    fieldProps: {
                      label: '投递间隔',
                      'data-help': '每个投递的间隔,太快易风控,默认值2s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                      suffix: ' 秒',
                    },
                  },
                  {
                    type: 'inputNumber',
                    key: 'delayDeliveryPageNext',
                    fieldProps: {
                      label: '投递翻页',
                      'data-help': '投递完下一页之后等待的间隔,太快易风控,默认值60s',
                    },
                    inputNumberProps: {
                      min: 1,
                      max: 99999,
                      suffix: ' 秒',
                    },
                  },
                ],
              },
            ],
          },
        ],
      ]
    })
  }
  override async onJobCardClick(key: string) {
    const job = this.jobMaps.get(key)
    if (!job) {
      throw new Error('未找到job数据')
    }
    if (isInitialized(job.rawData.detail)) {
      applyBossDetail(job.jobData, job.rawData.detail)
      return
    }
    const readBlockReason = () => bossAccessBlockReason(document.body?.innerText ?? '')
    const blocked = readBlockReason()
    if (blocked) throw new Error(blocked)
    this._clickJobCardAction(job.rawData.jobitem)
    const detail = await waitForBossDetail(() => this._jobDetail.value, job.rawData.jobitem, {
      isStopped: () => this.workflow?.status.value === 'stop',
      readBlockReason,
    })

    job.rawData.detail = detail
    applyBossDetail(job.jobData, detail)
    this.jobMaps.set(key, job)
  }
  async _initJobList() {
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'jobList',
      this._jobList,
      (v) => {
        this.jobList.value = v.map((item) => {
          const listed = convertBossZpJobItemToJobData(item)
          const previous = this.jobMaps.get(listed.key)
          const rawData = previous?.rawData ??
            this._jobDataMap.get(listed.key) ?? {
              jobitem: item,
              detail: createLazyObject<BossZpDetailData>('岗位详情获取'),
            }
          rawData.jobitem = item
          const job = refreshBossListJob(
            previous?.jobData,
            listed,
            isInitialized(rawData.detail) ? rawData.detail : undefined,
          )
          this._jobDataMap.set(job.key, rawData)
          this.jobMaps.set(
            job.key,
            previous ?? { jobData: job, rawData, state: { inputKeys: this.activeInputKeys } },
          )
          return job
        })
      },
    )()
  }

  async _initPage() {
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'pageVo',
      this._page,
    )()
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'hasMore',
      this._pageHasMore,
    )()
  }

  async _initJobDetail() {
    await useHookVueData(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'jobDetail',
      this._jobDetail,
    )()
  }

  async _initPageChange() {
    let pc =
      location.href.includes('/web/geek/job-recommend') || location.href.includes('/web/geek/jobs')
        ? await initSearch()
        : await initChange()
    if (!pc) {
      throw new Error('pageChange is undefined')
    }
    this._pageChange = pc
  }

  async _initClickJobCardAction() {
    this._clickJobCardAction = await useHookVueFn(
      '#wrap .page-job-wrapper,.job-recommend-main,.page-jobs-main',
      'clickJobCardAction',
    )()
  }
}

export default defineUnlistedScript(async () => {
  const script = document.currentScript as HTMLScriptElement
  initCounter(script)
  const bossHelpCtx = await BossHelperCtx.new()
  providePageWorkflow(script, bossHelpCtx)

  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      event.data?.source !== 'boss-helper' ||
      event.data?.type !== 'open-sidebar'
    ) {
      return
    }
    void bossHelpCtx.onMount()
  })

  await run(bossHelpCtx)
})
