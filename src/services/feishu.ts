import type { JobData } from '@/composables/useHelper'
import { counter } from '@/message'
import type { FeishuConfig } from '@/types/formData'

import { formatUrlField } from './feishuFields'
import type { JobMatchResult } from './jobMatching'

interface FeishuResponse {
  code?: unknown
  msg?: unknown
  tenant_access_token?: unknown
  expire?: unknown
  data?: unknown
}

type JsonRequestInit = {
  method?: string
  body?: BodyInit | null
  headers?: Record<string, string>
}

export type FeishuRequestAdapter = (url: string, init: JsonRequestInit) => Promise<FeishuResponse>

let tokenCache: { key: string; token: string; expiresAt: number } | undefined
let requestAdapter: FeishuRequestAdapter | undefined

const apiBase = 'https://open.feishu.cn/open-apis'
export const feishuFieldNames = {
  sourceJobId: 'BOSS 岗位 ID',
  title: '岗位名称',
  company: '公司名称',
  companyLink: '公司链接',
  salary: '薪资',
  salaryMin: '薪资下限（月）',
  salaryMax: '薪资上限（月）',
  internshipDuration: '实习周期',
  city: '城市',
  district: '区县',
  businessDistrict: '商圈',
  address: '详细地址',
  education: '学历要求',
  experience: '经验要求',
  skills: '职位技能',
  labels: '岗位标签',
  companyScale: '公司规模',
  companyIndustry: '公司行业',
  companyStage: '融资阶段',
  recruiter: '招聘者',
  jobStatus: '岗位状态',
  description: '完整 JD',
  decision: 'AI 决策',
  reason: 'AI 判断理由',
  matchPoints: 'AI 匹配点',
  gaps: 'AI 缺口与风险',
  uncertainties: 'AI 待核实项',
  applicationProgress: '求职进度',
  syncedAt: '同步时间',
} as const

export type FeishuJobSnapshot = {
  internshipDuration: string
  city: string
  district: string
  businessDistrict: string
  address: string
  skills: string[]
  labels: string[]
  companyScale: string
  companyIndustry: string
  companyStage: string
  recruiter: string
  jobStatus: string
}

export async function upsertJobToFeishu(
  job: JobData,
  sourceJobId: string,
  matchResult: JobMatchResult | undefined,
  config: FeishuConfig,
  snapshot: FeishuJobSnapshot,
): Promise<{ recordId: string; created: boolean }> {
  validateConfig(config)
  const token = await getTenantAccessToken(config)
  const recordsUrl = `${apiBase}/bitable/v1/apps/${encodeURIComponent(config.appToken)}/tables/${encodeURIComponent(config.tableId)}/records`
  const jobUrl = formatUrlField(job.link, job.jobName)
  const companyUrl = formatUrlField(job.brand.link, job.brand.name)
  const salaryRange = parseMonthlySalaryRange(job.salary)
  const fields = {
    [feishuFieldNames.sourceJobId]: sourceJobId,
    [feishuFieldNames.title]: jobUrl ?? job.jobName,
    [feishuFieldNames.company]: job.brand.name,
    [feishuFieldNames.companyLink]: companyUrl ?? job.brand.link ?? '',
    [feishuFieldNames.salary]: job.salary,
    ...(salaryRange
      ? {
          [feishuFieldNames.salaryMin]: salaryRange.min,
          [feishuFieldNames.salaryMax]: salaryRange.max,
        }
      : {}),
    [feishuFieldNames.internshipDuration]: snapshot.internshipDuration,
    [feishuFieldNames.city]: snapshot.city,
    [feishuFieldNames.district]: snapshot.district,
    [feishuFieldNames.businessDistrict]: snapshot.businessDistrict,
    [feishuFieldNames.address]: snapshot.address,
    [feishuFieldNames.education]: normalizeEducation(job.degreeName),
    [feishuFieldNames.experience]: normalizeExperience(job.experienceName),
    [feishuFieldNames.skills]: snapshot.skills,
    [feishuFieldNames.labels]: snapshot.labels,
    [feishuFieldNames.companyScale]: normalizeCompanyScale(snapshot.companyScale),
    [feishuFieldNames.companyIndustry]: snapshot.companyIndustry,
    [feishuFieldNames.companyStage]: normalizeCompanyStage(snapshot.companyStage),
    [feishuFieldNames.recruiter]: snapshot.recruiter,
    [feishuFieldNames.jobStatus]: normalizeJobStatus(snapshot.jobStatus),
    [feishuFieldNames.description]: job.jobDescription,
    [feishuFieldNames.decision]: matchResult?.decision ?? 'NOT_RUN',
    [feishuFieldNames.reason]: matchResult?.reason ?? '',
    [feishuFieldNames.matchPoints]: formatList(matchResult?.matchPoints),
    [feishuFieldNames.gaps]: formatList(matchResult?.gaps),
    [feishuFieldNames.uncertainties]: formatList(matchResult?.uncertainties),
    [feishuFieldNames.syncedAt]: formatDateTime(new Date()),
  }
  const recordId = await findRecordId(recordsUrl, sourceJobId, token)

  if (recordId) {
    await feishuRequest(`${recordsUrl}/${encodeURIComponent(recordId)}`, token, {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    })
    return { recordId, created: false }
  }

  const created = await feishuRequest(recordsUrl, token, {
    method: 'POST',
    // 求职进度由用户在飞书维护；仅在首次入库时给出可见的初始状态，
    // 后续同步绝不覆盖它。
    body: JSON.stringify({
      fields: { ...fields, [feishuFieldNames.applicationProgress]: '待处理' },
    }),
  })
  const data = expectRecord(created.data, '飞书创建记录 data')
  const record = expectRecord(data.record, '飞书创建记录 record')
  if (typeof record.record_id !== 'string' || !record.record_id) {
    throw new Error('飞书创建记录响应缺少 record_id')
  }
  return { recordId: record.record_id, created: true }
}

function formatList(items: string[] | undefined): string {
  return items?.map((item) => `• ${item}`).join('\n') ?? ''
}

function parseMonthlySalaryRange(
  value: string | undefined,
): { min: number; max: number } | undefined {
  if (!value) return undefined
  const match = value.match(/(\d+(?:\.\d+)?)\s*[-~～]\s*(\d+(?:\.\d+)?)\s*[kK]/)
  if (!match) return undefined
  const min = Number(match[1]) * 1000
  const max = Number(match[2]) * 1000
  return Number.isFinite(min) && Number.isFinite(max) && min <= max ? { min, max } : undefined
}

function normalizeEducation(value: string | undefined): string {
  if (!value || value.includes('不限')) return '不限'
  if (value.includes('博士')) return '博士'
  if (value.includes('硕士') || value.includes('研究生')) return '硕士'
  if (value.includes('本科')) return '本科'
  if (value.includes('大专')) return '大专'
  return '其他'
}

function normalizeExperience(value: string | undefined): string {
  if (!value || value.includes('不限')) return '不限'
  if (value.includes('在校') || value.includes('应届') || value.includes('实习')) return '在校生'
  if (value.includes('1年以内')) return '1年以内'
  if (value.includes('1-3年')) return '1-3年'
  if (value.includes('3-5年')) return '3-5年'
  if (value.includes('5-10年')) return '5-10年'
  if (value.includes('10年')) return '10年以上'
  return '其他'
}

function normalizeCompanyScale(value: string | undefined): string {
  if (!value) return '未知'
  const known = ['0-20人', '20-99人', '100-499人', '500-999人', '1000-9999人', '10000人以上']
  return known.find((item) => value.includes(item)) ?? '未知'
}

function normalizeCompanyStage(value: string | undefined): string {
  if (!value) return '未知'
  const known = ['未融资', '天使轮', 'A轮', 'B轮', 'C轮', 'D轮及以上', '已上市', '不需要融资']
  return known.find((item) => value.includes(item)) ?? '未知'
}

function normalizeJobStatus(value: string | undefined): string {
  const known = ['最新', '急招']
  return known.find((item) => value?.includes(item)) ?? '正常'
}

function formatDateTime(date: Date): number {
  // 飞书多维表格的 datetime 字段写入时要求 Unix 毫秒时间戳；
  // 格式化字符串仅适用于文本字段。
  return date.getTime()
}

async function getTenantAccessToken(config: FeishuConfig): Promise<string> {
  const key = `${config.appId}:${config.appSecret}`
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now()) return tokenCache.token

  const payload = await backgroundRequest(`${apiBase}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  })
  if (typeof payload.tenant_access_token !== 'string' || !payload.tenant_access_token) {
    throw new Error('飞书鉴权响应缺少 tenant_access_token')
  }
  const expireSeconds = typeof payload.expire === 'number' ? payload.expire : 7200
  tokenCache = {
    key,
    token: payload.tenant_access_token,
    expiresAt: Date.now() + Math.max(60, expireSeconds - 300) * 1000,
  }
  return tokenCache.token
}

async function findRecordId(
  recordsUrl: string,
  sourceJobId: string,
  token: string,
): Promise<string | undefined> {
  const result = await feishuRequest(`${recordsUrl}/search?page_size=1`, token, {
    method: 'POST',
    body: JSON.stringify({
      filter: {
        conjunction: 'and',
        conditions: [
          { field_name: feishuFieldNames.sourceJobId, operator: 'is', value: [sourceJobId] },
        ],
      },
    }),
  })
  const data = expectRecord(result.data, '飞书查询记录 data')
  if (!Array.isArray(data.items)) throw new Error('飞书查询记录响应缺少 items')
  if (data.items.length === 0) return undefined
  const record = expectRecord(data.items[0], '飞书查询记录 item')
  if (typeof record.record_id !== 'string' || !record.record_id) {
    throw new Error('飞书查询记录响应包含无效 record_id')
  }
  return record.record_id
}

async function feishuRequest(
  url: string,
  token: string,
  init: JsonRequestInit,
): Promise<FeishuResponse> {
  return backgroundRequest(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}` },
  })
}

async function backgroundRequest(url: string, init: JsonRequestInit): Promise<FeishuResponse> {
  let payload: unknown
  try {
    if (requestAdapter) {
      payload = await requestAdapter(url, init)
    } else {
      payload = await counter.request({
        url,
        data: {
          ...init,
          headers: { 'Content-Type': 'application/json', ...init.headers },
        },
        timeout: 30,
        responseType: 'json',
      })
    }
  } catch (error) {
    throw normalizeFeishuError(error)
  }
  const response = expectRecord(payload, '飞书响应') as FeishuResponse
  if (response.code !== 0) {
    const message = typeof response.msg === 'string' ? response.msg : '未知错误'
    throw normalizeFeishuError(new Error(`飞书 API 错误 (${String(response.code)}): ${message}`))
  }
  return response
}

/** Test-only seam. Production requests always use the extension background proxy. */
export function setFeishuRequestAdapterForTest(adapter: FeishuRequestAdapter | undefined) {
  requestAdapter = adapter
  tokenCache = undefined
}

function normalizeFeishuError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('99991672')) {
    return new Error(
      '飞书应用缺少多维表格读写权限（bitable:app）。请在飞书开放平台开通该权限并发布应用版本后重试；当前岗位未投递。',
    )
  }
  if (message.includes('1254068')) {
    return new Error(
      '飞书“岗位名称”超链接格式不匹配。请确认该列保持“超链接”类型，并重新加载最新版扩展后重试；当前岗位未投递。',
    )
  }
  if (message.includes('1254060')) {
    return new Error(
      '飞书文本字段格式不匹配。请确认“同步时间”等文本列未被改成其他字段类型，并重新加载最新版扩展后重试；当前岗位未投递。',
    )
  }
  if (message.includes('1254064')) {
    return new Error(
      '飞书“同步时间”字段格式不匹配。请保持该列为日期时间类型；扩展会写入毫秒时间戳。当前岗位未投递。',
    )
  }
  return error instanceof Error ? error : new Error(message)
}

function validateConfig(config: FeishuConfig) {
  if (!config.appId.trim()) throw new Error('飞书 App ID 不能为空')
  if (!config.appSecret.trim()) throw new Error('飞书 App Secret 不能为空')
  if (!config.appToken.trim()) throw new Error('飞书 app_token 不能为空')
  if (!config.tableId.trim()) throw new Error('飞书 table_id 不能为空')
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name}必须是对象`)
  }
  return value as Record<string, unknown>
}
