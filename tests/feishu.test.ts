import assert from 'node:assert/strict'
import test from 'node:test'

import {
  feishuFieldNames,
  setFeishuRequestAdapterForTest,
  upsertJobToFeishu,
  readJobFromFeishu,
  validateFeishuSchema,
} from '../src/services/feishu.ts'

const config = {
  enable: true,
  appId: 'test-app-id',
  appSecret: 'test-app-secret',
  appToken: 'test-app-token',
  tableId: 'test-table-id',
}

const job = {
  link: 'https://www.zhipin.com/job_detail/job-test.html',
  jobName: '脱敏岗位',
  salary: '10-15K',
  degreeName: '本科',
  experienceName: '1-3年',
  jobDescription: '脱敏岗位介绍',
  brand: { name: '脱敏公司', link: 'https://www.zhipin.com/gongsi/company-test.html' },
} as any

const snapshot = {
  internshipDuration: '',
  city: '测试城市',
  district: '',
  businessDistrict: '',
  address: '',
  skills: ['TypeScript'],
  labels: ['本科'],
  companyScale: '20-99人',
  companyIndustry: '互联网',
  companyStage: 'A轮',
  recruiter: '招聘者 · HR',
  jobStatus: '正常',
}

void test('Feishu upsert authenticates, deduplicates, creates and preserves user progress on update', async () => {
  const calls: Array<{ url: string; init: { method?: string; body?: BodyInit | null } }> = []
  let searchCount = 0
  setFeishuRequestAdapterForTest(async (url, init) => {
    calls.push({ url, init })
    if (url.includes('/auth/')) return { code: 0, tenant_access_token: 'test-token', expire: 7200 }
    if (url.includes('/search')) {
      searchCount++
      return {
        code: 0,
        data: {
          items:
            searchCount === 1
              ? []
              : [
                  {
                    record_id: 'rec-existing',
                    fields: { [feishuFieldNames.applicationProgress]: '面试中' },
                  },
                ],
        },
      }
    }
    if (init.method === 'POST') return { code: 0, data: { record: { record_id: 'rec-created' } } }
    if (init.method === 'PUT') return { code: 0, data: {} }
    throw new Error('unexpected request')
  })

  try {
    const created = await upsertJobToFeishu(job, 'job-test', undefined, config, snapshot)
    assert.equal(created.recordId, 'rec-created')
    assert.equal(created.created, true)
    assert.equal(created.applicationProgress, '待处理')
    const updated = await upsertJobToFeishu(job, 'job-test', undefined, config, snapshot)
    assert.equal(updated.recordId, 'rec-existing')
    assert.equal(updated.created, false)
    assert.equal(updated.applicationProgress, '面试中')
    assert.equal(typeof updated.checkedAt, 'number')

    assert.equal(calls.filter((call) => call.url.includes('/auth/')).length, 1)
    const create = calls.find(
      (call) => call.init.method === 'POST' && call.url.endsWith('/records'),
    )!
    const createFields = JSON.parse(create.init.body as string).fields
    assert.equal(createFields[feishuFieldNames.company], job.brand.name)
    assert.equal(createFields[feishuFieldNames.applicationProgress], '待处理')
    assert.deepEqual(createFields[feishuFieldNames.title], {
      text: '脱敏岗位',
      link: 'https://www.zhipin.com/job_detail/job-test.html',
    })
    assert.equal(createFields[feishuFieldNames.salaryMin], 10000)
    assert.equal(createFields[feishuFieldNames.salaryMax], 15000)
    assert.equal(typeof createFields[feishuFieldNames.syncedAt], 'number')
    for (const key of ['decision', 'reason', 'matchPoints', 'gaps', 'uncertainties'] as const) {
      assert.equal(createFields[feishuFieldNames[key]], null)
    }

    const update = calls.find((call) => call.init.method === 'PUT')!
    const updateFields = JSON.parse(update.init.body as string).fields
    assert.equal(updateFields[feishuFieldNames.company], job.brand.name)
    assert.equal(updateFields[feishuFieldNames.applicationProgress], undefined)
    for (const key of ['decision', 'reason', 'matchPoints', 'gaps', 'uncertainties'] as const) {
      assert.equal(updateFields[feishuFieldNames[key]], null)
    }
  } finally {
    setFeishuRequestAdapterForTest(undefined)
  }
})

void test('enabled analysis writes all five AI fields', async () => {
  let written: any
  setFeishuRequestAdapterForTest(async (url, init) => {
    if (url.includes('/auth/')) return { code: 0, tenant_access_token: 'test-token' }
    if (url.includes('/search')) return { code: 0, data: { items: [] } }
    written = JSON.parse(init.body as string).fields
    return { code: 0, data: { record: { record_id: 'rec-analyzed' } } }
  })
  try {
    await upsertJobToFeishu(
      job,
      'job-test',
      {
        decision: 'REVIEW',
        reason: '需要复核',
        matchPoints: ['项目经验'],
        gaps: ['行业经验'],
        uncertainties: ['工作地点'],
      },
      config,
      snapshot,
    )
    assert.equal(written[feishuFieldNames.decision], 'REVIEW')
    assert.equal(written[feishuFieldNames.reason], '需要复核')
    assert.equal(written[feishuFieldNames.matchPoints], '• 项目经验')
    assert.equal(written[feishuFieldNames.gaps], '• 行业经验')
    assert.equal(written[feishuFieldNames.uncertainties], '• 工作地点')
  } finally {
    setFeishuRequestAdapterForTest(undefined)
  }
})

void test('readback accepts single-select and rich text progress, rejects malformed/duplicate records', async () => {
  let payload: any = {
    items: [{ record_id: 'rec', fields: { 求职进度: [{ text: '面试' }, { text: '中' }] } }],
  }
  const calls: string[] = []
  setFeishuRequestAdapterForTest(async (url, init) => {
    calls.push(url)
    if (url.includes('/auth/')) return { code: 0, tenant_access_token: 'test-token' }
    assert.ok(url.includes('page_size=2'))
    assert.deepEqual(JSON.parse(init.body as string).field_names, ['BOSS 岗位 ID', '求职进度'])
    return { code: 0, data: payload }
  })
  try {
    assert.equal((await readJobFromFeishu('job-test', config))?.applicationProgress, '面试中')
    payload = { items: [{ record_id: 'rec', fields: { 求职进度: '待处理' } }] }
    assert.equal((await readJobFromFeishu('job-test', config))?.applicationProgress, '待处理')
    payload = { items: [{ record_id: 'rec', fields: {} }] }
    assert.equal((await readJobFromFeishu('job-test', config))?.applicationProgress, '')
    payload = { items: [] }
    assert.equal(await readJobFromFeishu('job-test', config), undefined)
    payload = { items: [{ record_id: 'a' }, { record_id: 'b' }] }
    await assert.rejects(upsertJobToFeishu(job, 'job-test', undefined, config, snapshot), /重复/)
    payload = { items: [{ record_id: 'rec', fields: { 求职进度: { unknown: true } } }] }
    await assert.rejects(readJobFromFeishu('job-test', config), /格式不支持/)
    assert.ok(calls.every((url) => url.includes('/auth/') || url.includes('/search')))
  } finally {
    setFeishuRequestAdapterForTest(undefined)
  }
})

void test('schema preflight paginates, reports missing/incompatible fields and never writes', async () => {
  const types: Record<string, number> = {
    岗位名称: 15,
    公司链接: 15,
    '薪资下限（月）': 2,
    '薪资上限（月）': 2,
    职位技能: 4,
    岗位标签: 4,
    同步时间: 5,
    求职进度: 3,
    公司名称: 3,
    城市: 3,
    区县: 3,
    商圈: 3,
    学历要求: 3,
    经验要求: 3,
    公司规模: 3,
    公司行业: 3,
    融资阶段: 3,
    岗位状态: 3,
    'AI 决策': 3,
  }
  let fields = Object.values(feishuFieldNames).map((field_name) => ({
    field_name,
    type: types[field_name] ?? 1,
  }))
  let badPagination = false
  setFeishuRequestAdapterForTest(async (url, init) => {
    if (url.includes('/auth/')) return { code: 0, tenant_access_token: 'test-token' }
    assert.equal(init.method, 'GET')
    if (badPagination) return { code: 0, data: { items: [], has_more: true, page_token: 'repeat' } }
    return {
      code: 0,
      data: url.includes('page_token=next')
        ? { items: fields.slice(10), has_more: false }
        : { items: fields.slice(0, 10), has_more: true, page_token: 'next' },
    }
  })
  try {
    await validateFeishuSchema(config)
    // Preserve compatibility with older text-company tables, but not multi-select.
    const companyField = fields.find((field) => field.field_name === '公司名称')!
    companyField.type = 1
    await validateFeishuSchema(config)
    companyField.type = 4
    await assert.rejects(validateFeishuSchema(config), /公司名称.*类型为 4/)
    companyField.type = 3
    fields = fields.filter((field) => field.field_name !== '完整 JD')
    fields.find((field) => field.field_name === '同步时间')!.type = 1
    await assert.rejects(validateFeishuSchema(config), /完整 JD.*同步时间|同步时间.*完整 JD/)
    badPagination = true
    await assert.rejects(validateFeishuSchema(config), /分页响应无效/)
  } finally {
    setFeishuRequestAdapterForTest(undefined)
  }
})

void test('Feishu field errors remain failures and never become successful writes', async () => {
  setFeishuRequestAdapterForTest(async (url) => {
    if (url.includes('/auth/')) return { code: 0, tenant_access_token: 'test-token', expire: 7200 }
    if (url.includes('/search')) return { code: 0, data: { items: [] } }
    return { code: 1254068, msg: 'URLFieldConvFail' }
  })
  try {
    await assert.rejects(
      upsertJobToFeishu(job, 'job-test', undefined, config, snapshot),
      /岗位名称.*超链接格式不匹配/,
    )
  } finally {
    setFeishuRequestAdapterForTest(undefined)
  }
})
