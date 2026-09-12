import { TaskRegistry, taskResult } from '@/composables/useApplying/handles'
import { defineTaskHandler, defineTaskWorkflow } from '@/composables/useApplying/type'
import { upsertJobToFeishu } from '@/services/feishu'
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

export type BossWorkflowState = {
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

export const bossWorkflow = defineTaskWorkflow<BossHelperCtx, BoosJobData, BossWorkflowState>(
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
  tasks.aiFiltering({ deps: ['岗位详情获取'] }), // AI过滤

  defineTaskHandler('岗位投递', (ctx) => async (_, data) => {
    const matchResult = data.state.aiMatchResult
    const decision = matchResult?.decision
    const shouldDeliver = decision
      ? shouldDeliverJob(
          decision,
          ctx.helper.conf.formData.autoDelivery.value,
          ctx.helper.conf.formData.deliverReview.value,
        )
      : false

    data.state.delivered = false
    if (ctx.helper.conf.formData.feishu.enable) {
      const result = await upsertJobToFeishu(
        data.jobData,
        data.rawData.jobitem.encryptJobId,
        matchResult,
        ctx.helper.conf.formData.feishu,
        buildFeishuJobSnapshot(data.rawData),
      )
      data.state.feishuRecordId = result.recordId
    }

    if (shouldDeliver) {
      await sendPublishReq({
        securityId: data.rawData.jobitem.securityId,
        encryptJobId: data.rawData.jobitem.encryptJobId,
      })
      data.state.delivered = true
      if (ctx.helper.conf.formData.feishu.enable) {
        await upsertJobToFeishu(
          data.jobData,
          data.rawData.jobitem.encryptJobId,
          matchResult,
          ctx.helper.conf.formData.feishu,
          buildFeishuJobSnapshot(data.rawData),
        )
      }
    }

    if (!matchResult) return taskResult.skip('AI简历匹配未开启，未投递')
    if (matchResult.decision === 'REJECT') {
      return taskResult.skip(`AI: REJECT；${matchResult.reason}`)
    }
    if (!ctx.helper.conf.formData.autoDelivery.value) {
      return taskResult.skip(`AI: ${matchResult.decision}；${matchResult.reason}；自动投递已关闭`)
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
