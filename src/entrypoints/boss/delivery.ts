import { useDeliveryWorkflow } from '@/composables/useApplying'
import { TaskRegistry, taskResult } from '@/composables/useApplying/handles'
import { defineTaskHandler, defineTaskWorkflow } from '@/composables/useApplying/type'
import { runStage } from '@/services/collectionStages'
import type { CollectionState } from '@/services/collectionStages'
import { upsertJobToFeishu, validateFeishuConfig } from '@/services/feishu'
import type { FeishuJobSnapshot } from '@/services/feishu'
import { shouldDeliverJob } from '@/services/jobMatching'
import type { JobMatchResult } from '@/services/jobMatching'

import type { BossHelperCtx } from '.'
import { sendPublishReq } from './requests'
import type { BossZpJobItemData, BossZpDetailData } from './types'

export type BoosJobData = {
  jobitem: BossZpJobItemData
  detail: BossZpDetailData
}

export type BossWorkflowState = CollectionState & {
  aiMatchResult?: JobMatchResult
  delivered?: boolean
  feishuRecordId?: string
}

function buildFeishuJobSnapshot(data: BoosJobData): FeishuJobSnapshot {
  const { jobitem, detail } = data
  const jobInfo = detail.jobInfo
  const brand = detail.brandComInfo
  const recruiter = detail.bossInfo

  return {
    internshipDuration: [jobitem.daysPerWeekDesc, jobitem.leastMonthDesc]
      .filter(Boolean)
      .join(' · '),
    city: jobInfo.locationName || jobitem.cityName,
    district: jobitem.areaDistrict || '',
    businessDistrict: jobitem.businessDistrict || '',
    address: jobInfo.address || '',
    skills: jobInfo.showSkills?.length ? jobInfo.showSkills : jobitem.skills || [],
    labels: jobitem.jobLabels || [],
    companyScale: brand.scaleName || jobitem.brandScaleName || '',
    companyIndustry: brand.industryName || jobitem.brandIndustry || '',
    companyStage: brand.stageName || jobitem.brandStageName || '',
    recruiter: [recruiter.name || jobitem.bossName, recruiter.title || jobitem.bossTitle]
      .filter(Boolean)
      .join(' · '),
    jobStatus: jobInfo.jobStatusDesc || '',
  }
}

const tasks = new TaskRegistry<BossHelperCtx, BoosJobData, BossWorkflowState>()

const collectDetail = defineTaskHandler<BossHelperCtx, BoosJobData, BossWorkflowState>(
  '岗位详情获取',
  () => async (ctx, data) => {
    const completed = await runStage(
      data.state,
      'detail',
      async () => {
        await ctx.helper.onJobCardClick(data.jobData.key)
        if (!data.jobData.jobDescription.trim())
          throw new Error('岗位详情缺少完整 JD，请重试详情获取')
      },
      { isStopped: () => ctx.helper.workflow?.status.value === 'stop' },
    )
    if (!completed && ctx.helper.workflow?.status.value !== 'stop')
      return taskResult.error('详情阶段仍在执行或结果待核实')
  },
  { state: 'request', stateMsg: '获取岗位详情' },
)

const collectAnalysis = defineTaskHandler<BossHelperCtx, BoosJobData, BossWorkflowState>(
  'AI分析',
  async (ctx) => {
    const initialized = await tasks.aiFiltering().task(ctx)
    const analyze = typeof initialized === 'function' ? initialized : initialized?.fn
    return async (ctx, data) => {
      const completed = await runStage(
        data.state,
        'analysis',
        async () => {
          await analyze!(ctx, data)
        },
        {
          enabled: !!analyze,
          isStopped: () => ctx.helper.workflow?.status.value === 'stop',
        },
      )
      if (!completed && ctx.helper.workflow?.status.value !== 'stop')
        return taskResult.error('分析阶段仍在执行或结果待核实')
    }
  },
  { state: 'ai', stateMsg: '分析岗位适配度', deps: ['岗位详情获取'] },
)

const collectStorage = defineTaskHandler<BossHelperCtx, BoosJobData, BossWorkflowState>(
  '岗位入库',
  (ctx) => {
    const config = ctx.helper.conf.formData.feishu
    if (config.enable) validateFeishuConfig(config)
    return async (ctx, data) => {
      const completed = await runStage(
        data.state,
        'storage',
        async () => {
          const result = await upsertJobToFeishu(
            data.jobData,
            data.rawData.jobitem.encryptJobId,
            data.state.aiMatchResult,
            config,
            buildFeishuJobSnapshot(data.rawData),
          )
          data.state.feishuRecordId = result.recordId
        },
        { enabled: config.enable, isStopped: () => ctx.helper.workflow?.status.value === 'stop' },
      )
      if (!completed && ctx.helper.workflow?.status.value !== 'stop')
        return taskResult.error('入库阶段仍在执行或结果待核实')
      // Collection never sends, regardless of the legacy autoDelivery setting.
      data.state.delivered ??= false
    }
  },
  { state: 'running', stateMsg: '同步飞书', deps: ['AI分析'] },
)

/** Every listed job reaches detail/analysis/storage, including REJECT decisions. */
export const bossWorkflow = (ctx: BossHelperCtx) =>
  useDeliveryWorkflow([collectDetail(), collectAnalysis(), collectStorage()], ctx, {
    mode: 'collection',
  })

/** Invoked for one explicitly confirmed job only; never part of collection. */
export const bossDeliveryWorkflow = defineTaskWorkflow<
  BossHelperCtx,
  BoosJobData,
  BossWorkflowState
>(
  defineTaskHandler('采集结果检查', () => async (_, data) => {
    if (data.state.delivered || data.state.stages?.delivery?.status === 'succeeded') {
      return taskResult.skip('该岗位已投递，不重复发送')
    }
    if (['running', 'unknown'].includes(data.state.stages?.delivery?.status ?? '')) {
      return taskResult.error('上次发送结果不确定，请先在 BOSS 核实，禁止自动重试')
    }
    if (
      data.state.stages?.detail?.status !== 'succeeded' ||
      data.state.stages?.analysis?.status !== 'succeeded'
    ) {
      return taskResult.error('请先完成该岗位的详情采集和 AI 分析')
    }
  }),
  defineTaskHandler(
    '已沟通',
    async () => {
      return async (_, { rawData }) => {
        if (rawData.jobitem.contact) {
          return taskResult.skip('已沟通')
        }
      }
    },
    {
      desc: '已沟通过滤',
    },
  ), // 已沟通过滤
  tasks.SameCompanyFilter(), // 相同公司过滤
  tasks.SameHrFilter(), // 相同hr过滤
  tasks.jobTitle(), // 岗位名筛选
  tasks.company(), // 公司名筛选
  tasks.salaryRange(), // 薪资筛选
  tasks.companySizeRange(), // 公司规模筛选
  tasks.goldHunterFilter(), // 猎头过滤
  defineTaskHandler(
    '岗位详情获取',
    () => async (ctx, job) => {
      await ctx.helper.onJobCardClick(job.jobData.key)
    },
    {
      state: 'request',
      stateMsg: '获取岗位详情',
    },
  ), // 获取岗位详情
  tasks.activityFilter({ deps: ['岗位详情获取'] }), // 活跃度过滤
  tasks.hrPosition({ deps: ['岗位详情获取'] }), // Hr职位筛选
  tasks.jobAddress({ deps: ['岗位详情获取'] }), // 工作地址筛选
  tasks.jobFriendStatus({ deps: ['岗位详情获取'] }), // 好友状态过滤
  tasks.jobContent({ deps: ['岗位详情获取'] }), // 工作内容筛选

  defineTaskHandler(
    '金牌面试官',
    (ctx) => {
      if (!ctx.helper.conf.formData.bossGoldMedalHr.value) {
        return
      }
      return async (_, { rawData }) => {
        if (
          rawData?.detail?.bossInfo?.avatarStickerUrl?.includes(
            '492b4ca74ee6ee7bfecf8d0d363780c68ad8b582857d894c8eae833b21840fb6',
          )
        ) {
          return taskResult.skip('金牌HR')
        }
      }
    },
    { deps: ['岗位详情获取'] },
  ), // 金牌面试官过滤

  tasks.amap({ deps: ['岗位详情获取'] }), // 高德地图
  defineTaskHandler('岗位投递', (ctx) => async (_, data) => {
    const matchResult = data.state.aiMatchResult
    const decision = matchResult?.decision
    const shouldDeliver = decision
      ? shouldDeliverJob(
          decision,
          true, // Only an explicit per-job command reaches this workflow.
          ctx.helper.conf.formData.deliverReview.value,
        )
      : false

    if (shouldDeliver) {
      try {
        await runStage(data.state, 'delivery', async () => {
          // Do not automatically retry a POST whose response may have been lost.
          await sendPublishReq(
            {
              securityId: data.rawData.jobitem.securityId,
              encryptJobId: data.rawData.jobitem.encryptJobId,
            },
            undefined,
            1,
          )
          data.state.delivered = true
        })
      } catch (error) {
        if (data.state.stages?.delivery) data.state.stages.delivery.status = 'unknown'
        throw error
      }
    }

    if (!matchResult) return taskResult.skip('AI简历匹配未开启，未投递')
    if (matchResult.decision === 'REJECT') {
      return taskResult.skip(`AI: REJECT；${matchResult.reason}`)
    }
    if (matchResult.decision === 'REVIEW' && !ctx.helper.conf.formData.deliverReview.value) {
      return taskResult.skip(`AI: REVIEW；${matchResult.reason}；REVIEW 投递已关闭`)
    }
    return {
      status: 'success',
      msg: `AI: ${matchResult.decision}；${matchResult.reason}；投递成功`,
    }
  }), // 投递
)
