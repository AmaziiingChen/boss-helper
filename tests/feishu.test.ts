import assert from 'node:assert/strict'
import test from 'node:test'

import {
  feishuFieldNames,
  setFeishuRequestAdapterForTest,
  upsertJobToFeishu,
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
      return { code: 0, data: { items: searchCount === 1 ? [] : [{ record_id: 'rec-existing' }] } }
    }
    if (init.method === 'POST') return { code: 0, data: { record: { record_id: 'rec-created' } } }
    if (init.method === 'PUT') return { code: 0, data: {} }
    throw new Error('unexpected request')
  })

  try {
    assert.deepEqual(await upsertJobToFeishu(job, 'job-test', undefined, config, snapshot), {
      recordId: 'rec-created',
      created: true,
    })
    assert.deepEqual(await upsertJobToFeishu(job, 'job-test', undefined, config, snapshot), {
      recordId: 'rec-existing',
      created: false,
    })

    assert.equal(calls.filter((call) => call.url.includes('/auth/')).length, 1)
    const create = calls.find(
      (call) => call.init.method === 'POST' && call.url.endsWith('/records'),
    )!
    const createFields = JSON.parse(create.init.body as string).fields
    assert.equal(createFields[feishuFieldNames.applicationProgress], '待处理')
    assert.deepEqual(createFields[feishuFieldNames.title], {
      text: '脱敏岗位',
      link: 'https://www.zhipin.com/job_detail/job-test.html',
    })
    assert.equal(createFields[feishuFieldNames.salaryMin], 10000)
    assert.equal(createFields[feishuFieldNames.salaryMax], 15000)
    assert.equal(typeof createFields[feishuFieldNames.syncedAt], 'number')

    const update = calls.find((call) => call.init.method === 'PUT')!
    const updateFields = JSON.parse(update.init.body as string).fields
    assert.equal(updateFields[feishuFieldNames.applicationProgress], undefined)
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
