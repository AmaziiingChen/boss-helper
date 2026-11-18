import assert from 'node:assert/strict'
import test from 'node:test'
import type { TestContext } from 'node:test'

import {
  feishuFieldNames,
  setFeishuRequestAdapterForTest,
  testFeishuConnection,
} from '../src/services/feishu.ts'
import type { FeishuConnectionStep, FeishuRequestAdapter } from '../src/services/feishu.ts'

const config = {
  enable: true,
  appId: 'fake-connection-app-id',
  appSecret: 'fake-connection-secret',
  appToken: 'fake-connection-app-token',
  tableId: 'fake-connection-table-id',
}
const accessToken = 'fake-connection-access-token'
const types: Record<string, number> = {
  公司名称: 3,
  岗位名称: 15,
  公司链接: 15,
  '薪资下限（月）': 2,
  '薪资上限（月）': 2,
  职位技能: 4,
  岗位标签: 4,
  同步时间: 5,
  求职进度: 3,
}
const fields = Object.values(feishuFieldNames).map((field_name) => ({
  field_name,
  type: types[field_name] ?? 1,
}))
const secrets = [...Object.values(config).filter((value) => typeof value === 'string'), accessToken]

function assertRedacted(value: unknown) {
  const output = JSON.stringify(value)
  for (const secret of secrets) assert.equal(output.includes(secret), false)
}

const successResponse: FeishuRequestAdapter = async (url) => {
  if (url.includes('/auth/')) return { code: 0, tenant_access_token: accessToken, expire: 7200 }
  if (url.includes('/fields?')) return { code: 0, data: { items: fields, has_more: false } }
  return {
    code: 0,
    data: { items: [{ table_id: config.tableId, name: '岗位库' }], has_more: false },
  }
}

function install(t: TestContext, response: FeishuRequestAdapter = successResponse) {
  const calls: Array<{ url: string; init: Parameters<FeishuRequestAdapter>[1] }> = []
  setFeishuRequestAdapterForTest(async (url, init) => {
    calls.push({ url, init })
    // Authentication is the sole POST allowed; even reading records is out of scope.
    assert.equal(url.includes('/records'), false)
    assert.equal(init.method, url.includes('/auth/') ? 'POST' : 'GET')
    return response(url, init)
  })
  t.after(() => {
    setFeishuRequestAdapterForTest(undefined)
    assert.ok(
      calls.every(
        ({ url, init }) =>
          !url.includes('/records') && !['PUT', 'DELETE', 'PATCH'].includes(init.method ?? ''),
      ),
    )
  })
  return calls
}

void test('connection succeeds with all required fields and reports read-only progress without secrets', async (t) => {
  const calls = install(t)
  const progress: FeishuConnectionStep[][] = []
  const report = await testFeishuConnection(config, (steps) => progress.push(steps))
  assert.equal(report.success, true)
  assert.equal(report.readOnly, true)
  assert.equal(report.writeVerified, false)
  assert.equal(typeof report.checkedAt, 'number')
  assert.deepEqual(
    report.steps.map((step) => step.id),
    ['auth', 'table', 'schema'],
  )
  assert.deepEqual(
    report.steps.map((step) => step.status),
    ['success', 'success', 'success'],
  )
  assert.deepEqual(
    progress.map((steps) => steps.map((step) => step.status)),
    [
      ['running', 'pending', 'pending'],
      ['success', 'pending', 'pending'],
      ['success', 'running', 'pending'],
      ['success', 'success', 'pending'],
      ['success', 'success', 'running'],
      ['success', 'success', 'success'],
    ],
  )
  assert.equal(calls.length, 3)
  assertRedacted(report)
  assertRedacted(progress)
})

void test('consecutive connection checks always reauthenticate and use the newly issued token', async (t) => {
  let authCalls = 0
  const calls = install(t, async (url, init) => {
    if (url.includes('/auth/'))
      return { code: 0, tenant_access_token: `fake-token-${++authCalls}`, expire: 7200 }
    assert.equal(init.headers?.Authorization, `Bearer fake-token-${authCalls}`)
    return successResponse(url, init)
  })
  assert.equal((await testFeishuConnection(config)).success, true)
  assert.equal((await testFeishuConnection(config)).success, true)
  assert.equal(authCalls, 2)
  assert.equal(calls.length, 6)
})

for (const failure of ['auth', 'table', 'schema'] as const) {
  void test(`${failure} errors stop later steps and redact credentials in API error messages`, async (t) => {
    const exposed =
      failure === 'auth' ? secrets.filter((secret) => secret !== accessToken) : secrets
    const calls = install(t, async (url, init) => {
      const stage = url.includes('/auth/') ? 'auth' : url.includes('/fields?') ? 'schema' : 'table'
      if (stage === failure) return { code: 123, msg: exposed.join(' / ') }
      return successResponse(url, init)
    })
    const progress: FeishuConnectionStep[][] = []
    const report = await testFeishuConnection(config, (steps) => progress.push(steps))
    const index = ['auth', 'table', 'schema'].indexOf(failure)
    assert.equal(report.success, false)
    assert.deepEqual(
      report.steps.map((step) => step.status),
      [0, 1, 2].map((position) =>
        position < index ? 'success' : position === index ? 'error' : 'skipped',
      ),
    )
    assert.equal(calls.length, index + 1)
    assert.match(report.steps[index]!.message!, /已隐藏/)
    assertRedacted(report)
    assertRedacted(progress)
  })
}

void test('missing target table skips schema instead of accepting another accessible table', async (t) => {
  const calls = install(t, async (url, init) =>
    url.includes('/tables?')
      ? { code: 0, data: { items: [{ table_id: 'another-table' }], has_more: false } }
      : successResponse(url, init),
  )
  const report = await testFeishuConnection(config)
  assert.equal(report.success, false)
  assert.deepEqual(
    report.steps.map((step) => step.status),
    ['success', 'error', 'skipped'],
  )
  assert.match(report.steps[1]!.message!, /未找到/)
  assert.equal(calls.length, 2)
})

void test('schema incompatibility reports missing fields and wrong types without modifying them', async (t) => {
  install(t, async (url, init) =>
    url.includes('/fields?')
      ? {
          code: 0,
          data: {
            items: fields
              .filter((field) => field.field_name !== '完整 JD')
              .map((field) => (field.field_name === '同步时间' ? { ...field, type: 1 } : field)),
            has_more: false,
          },
        }
      : successResponse(url, init),
  )
  const report = await testFeishuConnection(config)
  assert.equal(report.success, false)
  assert.deepEqual(
    report.steps.map((step) => step.status),
    ['success', 'success', 'error'],
  )
  assert.match(report.steps[2]!.message!, /完整 JD/)
  assert.match(report.steps[2]!.message!, /同步时间/)
})

void test('table and field pagination follow page tokens before declaring full success', async (t) => {
  const calls = install(t, async (url, init) => {
    if (url.includes('/tables?') && !url.includes('page_token='))
      return {
        code: 0,
        data: { items: [{ table_id: 'other-table' }], has_more: true, page_token: 'tables/next' },
      }
    if (url.includes('/fields?'))
      return {
        code: 0,
        data: url.includes('page_token=')
          ? { items: fields.slice(10), has_more: false }
          : { items: fields.slice(0, 10), has_more: true, page_token: 'fields/next' },
      }
    return successResponse(url, init)
  })
  assert.equal((await testFeishuConnection(config)).success, true)
  assert.equal(calls.length, 5)
  assert.ok(calls.some(({ url }) => url.includes('page_token=tables%2Fnext')))
  assert.ok(calls.some(({ url }) => url.includes('page_token=fields%2Fnext')))
})

for (const stage of ['table', 'schema'] as const) {
  for (const pagination of ['missing', 'repeated'] as const) {
    void test(`${stage} refuses ${pagination} pagination tokens`, async (t) => {
      const calls = install(t, async (url, init) => {
        if (url.includes(stage === 'table' ? '/tables?' : '/fields?'))
          return {
            code: 0,
            data: {
              items: [],
              has_more: true,
              ...(pagination === 'repeated' ? { page_token: 'same-token' } : {}),
            },
          }
        return successResponse(url, init)
      })
      const report = await testFeishuConnection(config)
      const index = stage === 'table' ? 1 : 2
      assert.equal(report.success, false)
      assert.equal(report.steps[index]!.status, 'error')
      assert.match(report.steps[index]!.message!, /分页响应无效/)
      assert.equal(calls.length, index + (pagination === 'repeated' ? 2 : 1))
      if (stage === 'table') assert.equal(report.steps[2]!.status, 'skipped')
    })
  }
}

void test('invalid local credentials do not issue any requests', async (t) => {
  const calls = install(t)
  const report = await testFeishuConnection({ ...config, appSecret: '' })
  assert.equal(report.success, false)
  assert.deepEqual(
    report.steps.map((step) => step.status),
    ['error', 'skipped', 'skipped'],
  )
  assert.equal(calls.length, 0)
})
