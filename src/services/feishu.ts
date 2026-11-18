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

export interface FeishuJobRecord {
  recordId: string
  applicationProgress: string
  checkedAt: number
}

/** Read-only preflight; never create or alter the user's columns. */
export async function validateFeishuSchema(config: FeishuConfig): Promise<void> {
  validateFeishuConfig(config)
  const token = await getTenantAccessToken(config)
  await validateSchemaFields(config, token)
}

async function validateSchemaFields(config: FeishuConfig, token: string): Promise<void> {
  const types = new Map<string, number>()
  const seenPages = new Set<string>()
  let pageToken = ''
  do {
    const url = `${tableUrl(config)}/fields?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`
    const response = await feishuRequest(url, token, { method: 'GET' })
    const data = expectRecord(response.data, '飞书字段列表 data')
    if (!Array.isArray(data.items)) throw new Error('飞书字段列表响应缺少 items')
    for (const item of data.items) {
      const field = expectRecord(item, '飞书字段')
      if (typeof field.field_name !== 'string' || typeof field.type !== 'number')
        throw new Error('飞书字段名称或类型无效')
      types.set(field.field_name, field.type)
    }
    if (!data.has_more) break
    if (typeof data.page_token !== 'string' || !data.page_token || seenPages.has(data.page_token))
      throw new Error('飞书字段分页响应无效，未完成字段检查')
    pageToken = data.page_token
    seenPages.add(pageToken)
  } while (pageToken)

  const requiredTypes: Partial<Record<keyof typeof feishuFieldNames, number[]>> = {
    // The user's baseline table stores company names as single-select values.
    company: [1, 3],
    title: [15],
    companyLink: [15],
    salaryMin: [2],
    salaryMax: [2],
    skills: [4],
    labels: [4],
    syncedAt: [5],
    education: [1, 3],
    experience: [1, 3],
    companyScale: [1, 3],
    companyIndustry: [1, 3],
    companyStage: [1, 3],
    jobStatus: [1, 3],
    decision: [1, 3],
    applicationProgress: [1, 3],
    city: [1, 3],
    district: [1, 3],
    businessDistrict: [1, 3],
  }
  const problems: string[] = []
  for (const [key, name] of Object.entries(feishuFieldNames)) {
    const type = types.get(name)
    const expected = requiredTypes[key as keyof typeof feishuFieldNames] ?? [1]
    if (type === undefined) problems.push(`缺少“${name}”`)
    else if (!expected.includes(type))
      problems.push(`“${name}”类型为 ${type}，应为 ${expected.join('/')}`)
  }
  if (problems.length) throw new Error(`飞书字段不兼容：${problems.join('；')}。未修改表结构。`)
}

function tableUrl(config: FeishuConfig): string {
  return `${apiBase}/bitable/v1/apps/${encodeURIComponent(config.appToken)}/tables/${encodeURIComponent(config.tableId)}`
}

export interface FeishuConnectionStep {
  id: 'auth' | 'table' | 'schema'
  label: string
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped'
  message?: string
}

export interface FeishuConnectionReport {
  success: boolean
  checkedAt: number
  readOnly: true
  writeVerified: false
  steps: FeishuConnectionStep[]
}

/** Authenticate and read metadata only. Never read, create or modify job records. */
export async function testFeishuConnection(
  input: FeishuConfig,
  onProgress?: (steps: FeishuConnectionStep[]) => void,
): Promise<FeishuConnectionReport> {
  const config = { ...input }
  const steps: FeishuConnectionStep[] = [
    { id: 'auth', label: '应用凭据', status: 'pending' },
    { id: 'table', label: '目标表格访问', status: 'pending' },
    { id: 'schema', label: '必需字段与类型', status: 'pending' },
  ]
  const advice = [
    '请核对 App ID / App Secret，并确认应用已启用。',
    '请核对 App Token / Table ID，并确认应用拥有目标多维表格的访问权限。',
    '请核对多维表格读取权限及字段配置；测试不会修改表结构。',
  ]
  const emit = () => onProgress?.(steps.map((step) => ({ ...step })))
  let token = ''
  const actions = [
    async () => {
      validateFeishuConfig(config)
      // A connection test must not pass using a previously cached credential.
      token = await getTenantAccessToken(config, true)
      return '应用凭据验证通过。'
    },
    async () => {
      const seen = new Set<string>()
      let pageToken = ''
      for (let page = 0; page < 100; page++) {
        const response = await feishuRequest(
          `${apiBase}/bitable/v1/apps/${encodeURIComponent(config.appToken)}/tables?page_size=100${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ''}`,
          token,
          { method: 'GET' },
        )
        const data = expectRecord(response.data, '飞书表格列表 data')
        if (!Array.isArray(data.items)) throw new Error('飞书表格列表响应缺少 items')
        const table = data.items.find((item) => item?.table_id === config.tableId)
        if (table)
          return `已找到目标表格${typeof table.name === 'string' ? `“${table.name}”` : ''}。`
        if (!data.has_more) throw new Error('该多维表格中未找到指定 Table ID，或应用无权查看它')
        if (typeof data.page_token !== 'string' || !data.page_token || seen.has(data.page_token)) {
          throw new Error('飞书表格分页响应无效，未完成访问检查')
        }
        pageToken = data.page_token
        seen.add(pageToken)
      }
      throw new Error('表格数量超出本次检查范围，未完成访问检查')
    },
    async () => {
      await validateSchemaFields(config, token)
      return '所需字段及类型兼容；未验证记录写入权限。'
    },
  ]
  for (const [index, action] of actions.entries()) {
    const step = steps[index]!
    step.status = 'running'
    emit()
    try {
      step.message = await action()
      step.status = 'success'
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      // Never surface credentials, bearer tokens or full request details in UI diagnostics.
      for (const secret of [
        config.appSecret,
        config.appId,
        config.appToken,
        config.tableId,
        token,
      ]) {
        if (secret) message = message.replaceAll(secret, '[已隐藏]')
      }
      message = message.replace(/[；。]?当前岗位未投递。?/g, '')
      step.status = 'error'
      step.message = `${message} ${advice[index]}`
      for (const next of steps.slice(index + 1)) {
        next.status = 'skipped'
        next.message = '前一步未通过，尚未检查。'
      }
      emit()
      break
    }
    emit()
  }
  return {
    success: steps.every((step) => step.status === 'success'),
    checkedAt: Date.now(),
    readOnly: true,
    writeVerified: false,
    steps,
  }
}

/** Fresh remote evidence; not a cache or a claim that a BOSS message was sent. */
export async function readJobFromFeishu(
  sourceJobId: string,
  config: FeishuConfig,
): Promise<FeishuJobRecord | undefined> {
  validateFeishuConfig(config)
  const token = await getTenantAccessToken(config)
  return findJobRecord(`${tableUrl(config)}/records`, sourceJobId, token)
}

export async function upsertJobToFeishu(
  job: JobData,
  sourceJobId: string,
  matchResult: JobMatchResult | undefined,
  config: FeishuConfig,
  snapshot: FeishuJobSnapshot,
): Promise<FeishuJobRecord & { created: boolean }> {
  validateFeishuConfig(config)
  const token = await getTenantAccessToken(config)
  const recordsUrl = `${tableUrl(config)}/records`
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
    ...(matchResult
      ? {
          [feishuFieldNames.decision]: matchResult.decision,
          [feishuFieldNames.reason]: matchResult.reason,
          [feishuFieldNames.matchPoints]: formatList(matchResult.matchPoints),
          [feishuFieldNames.gaps]: formatList(matchResult.gaps),
          [feishuFieldNames.uncertainties]: formatList(matchResult.uncertainties),
        }
      : {
          [feishuFieldNames.decision]: null,
          [feishuFieldNames.reason]: null,
          [feishuFieldNames.matchPoints]: null,
          [feishuFieldNames.gaps]: null,
          [feishuFieldNames.uncertainties]: null,
        }),
    [feishuFieldNames.syncedAt]: formatDateTime(new Date()),
  }
  const existing = await findJobRecord(recordsUrl, sourceJobId, token)

  if (existing) {
    await feishuRequest(`${recordsUrl}/${encodeURIComponent(existing.recordId)}`, token, {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    })
    return { ...existing, created: false }
  }

  const created = await feishuRequest(recordsUrl, token, {
    method: 'POST',
    // 求职进度由用户在飞书维护；仅在首次入库时给出可见的初始状态，
    // 后续同步绝不覆盖它。
    body: JSON.stringify({
      fields: {
        ...fields,
        [feishuFieldNames.applicationProgress]: '待处理',
      },
    }),
  })
  const data = expectRecord(created.data, '飞书创建记录 data')
  const record = expectRecord(data.record, '飞书创建记录 record')
  if (typeof record.record_id !== 'string' || !record.record_id) {
    throw new Error('飞书创建记录响应缺少 record_id')
  }
  return {
    recordId: record.record_id,
    created: true,
    applicationProgress: '待处理',
    checkedAt: Date.now(),
  }
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

async function getTenantAccessToken(config: FeishuConfig, fresh = false): Promise<string> {
  const key = `${config.appId}:${config.appSecret}`
  if (!fresh && tokenCache?.key === key && tokenCache.expiresAt > Date.now())
    return tokenCache.token

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

async function findJobRecord(
  recordsUrl: string,
  sourceJobId: string,
  token: string,
): Promise<FeishuJobRecord | undefined> {
  if (!sourceJobId.trim()) throw new Error('BOSS 岗位 ID 不能为空')
  const result = await feishuRequest(`${recordsUrl}/search?page_size=2`, token, {
    method: 'POST',
    body: JSON.stringify({
      field_names: [feishuFieldNames.sourceJobId, feishuFieldNames.applicationProgress],
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
  if (data.items.length > 1 || data.has_more)
    throw new Error('飞书存在重复 BOSS 岗位 ID，请先合并确认；未选择任意一条覆盖')
  if (data.items.length === 0) return undefined
  const record = expectRecord(data.items[0], '飞书查询记录 item')
  if (typeof record.record_id !== 'string' || !record.record_id) {
    throw new Error('飞书查询记录响应包含无效 record_id')
  }
  const fields = expectRecord(record.fields, '飞书记录 fields')
  const value = fields[feishuFieldNames.applicationProgress]
  let applicationProgress = ''
  if (value != null) {
    if (typeof value === 'string') applicationProgress = value.trim()
    else if (Array.isArray(value) && value.every((item) => item && typeof item.text === 'string'))
      applicationProgress = value
        .map((item) => item.text)
        .join('')
        .trim()
    else throw new Error('飞书求职进度格式不支持，未将未知状态当作待处理')
  }
  return { recordId: record.record_id, applicationProgress, checkedAt: Date.now() }
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

export function validateFeishuConfig(config: FeishuConfig) {
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
