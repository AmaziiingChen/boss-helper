import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectionInputKeys,
  synchronizeCollectionInputs,
} from '../src/services/collectionInputs.ts'
import { runStage } from '../src/services/collectionStages.ts'

const config = () => ({
  resumeMarkdown: { content: '简历 A' },
  candidateProfile: { content: '工程背景' },
  aiFiltering: { enable: true, model: 'model', prompt: [{ role: 'user', content: '匹配' }] },
  feishu: { enable: true, appId: 'app', appToken: 'base', tableId: 'table', appSecret: 'secret' },
})
const model = {
  data: { model: 'fake-model', base_url: 'https://example.invalid/v1', api_key: 'secret' },
}

void test('input fingerprints cover resume, facts, prompts, model, toggles and destination without storing secrets', async () => {
  const form = config()
  const first = await collectionInputKeys(form, model)
  assert.match(first.analysis, /^[a-f0-9]{64}$/)
  assert.match(first.storage, /^[a-f0-9]{64}$/)
  for (const change of [
    (f: any) => {
      f.resumeMarkdown.content = '简历 B'
    },
    (f: any) => {
      f.candidateProfile.content = '新职业偏好'
    },
    (f: any) => {
      f.aiFiltering.prompt[0].content = '新提示词'
    },
    (f: any) => {
      f.aiFiltering.enable = false
    },
  ]) {
    const changed = config()
    change(changed)
    const keys = await collectionInputKeys(changed, model)
    assert.notEqual(keys.analysis, first.analysis)
    assert.notEqual(keys.storage, first.storage)
  }
  assert.notEqual(
    (await collectionInputKeys(form, { data: { ...model.data, model: 'new' } })).analysis,
    first.analysis,
  )
  assert.notEqual(
    (
      await collectionInputKeys(form, {
        data: { ...model.data, base_url: 'https://other.invalid' },
      })
    ).analysis,
    first.analysis,
  )
  const target = config()
  target.feishu.tableId = 'other-table'
  const keys = await collectionInputKeys(target, model)
  assert.equal(keys.analysis, first.analysis)
  assert.notEqual(keys.storage, first.storage)
  target.feishu.appSecret = 'changed-secret'
  assert.deepEqual(await collectionInputKeys(target, model), keys)
})

void test('changed resume reanalyzes and stores once, retaining details, delivery and greeting ledger', async () => {
  const form = config()
  const counts = { detail: 0, analysis: 0, storage: 0 }
  const state: any = {
    greetingSend: { status: 'unknown' },
    delivered: true,
    stages: { delivery: { status: 'succeeded', attempts: 1 } },
  }
  async function collect() {
    synchronizeCollectionInputs(state, await collectionInputKeys(form, model))
    await runStage(state, 'detail', () => {
      counts.detail++
    })
    await runStage(state, 'analysis', () => {
      counts.analysis++
      state.aiMatchResult = { decision: 'APPLY' }
    })
    await runStage(state, 'storage', () => {
      counts.storage++
      state.feishuRecord = { applicationProgress: '面试中' }
    })
  }
  await collect()
  await collect()
  assert.deepEqual(counts, { detail: 1, analysis: 1, storage: 1 })
  form.resumeMarkdown.content = '简历 B'
  await collect()
  assert.deepEqual(counts, { detail: 1, analysis: 2, storage: 2 })
  assert.equal(state.delivered, true)
  assert.equal(state.greetingSend.status, 'unknown')
  assert.equal(state.stages.delivery.status, 'succeeded')
  form.feishu.tableId = 'new'
  await collect()
  assert.deepEqual(counts, { detail: 1, analysis: 2, storage: 3 })
})

void test('legacy cached analysis is invalidated once; active analysis cannot be discarded', () => {
  const state: any = {
    aiMatchResult: { decision: 'APPLY' },
    stages: {
      detail: { status: 'succeeded', attempts: 1 },
      analysis: { status: 'succeeded', attempts: 1 },
    },
  }
  const keys = { analysis: 'a', storage: 'b' }
  assert.equal(synchronizeCollectionInputs(state, keys), true)
  assert.equal(state.aiMatchResult, undefined)
  assert.equal(state.stages.detail.status, 'succeeded')
  assert.equal(synchronizeCollectionInputs(state, keys), false)
  state.stages.analysis = { status: 'running', attempts: 1 }
  assert.throws(
    () => synchronizeCollectionInputs(state, { analysis: 'new', storage: 'new' }),
    /等待/,
  )
  assert.deepEqual(state.inputKeys, keys)
})

void test('AI toggle invalidates analysis and storage; disabled mode ignores resume and model edits', async () => {
  const form = config()
  const state: any = {
    inputKeys: await collectionInputKeys(form, model),
    aiMatchResult: { decision: 'APPLY' },
    stages: {
      detail: { status: 'succeeded', attempts: 1 },
      analysis: { status: 'succeeded', attempts: 1 },
      storage: { status: 'succeeded', attempts: 1 },
    },
  }
  form.aiFiltering.enable = false
  const disabled = await collectionInputKeys(form, model)
  assert.equal(synchronizeCollectionInputs(state, disabled), true)
  assert.equal(state.aiMatchResult, undefined)
  assert.equal(state.stages.analysis, undefined)
  assert.equal(state.stages.storage, undefined)
  assert.equal(state.stages.detail.status, 'succeeded')
  form.resumeMarkdown.content = ''
  form.candidateProfile.content = ''
  form.aiFiltering.prompt = []
  form.aiFiltering.model = ''
  assert.deepEqual(await collectionInputKeys(form, undefined), disabled)
  form.aiFiltering.enable = true
  assert.equal(synchronizeCollectionInputs(state, await collectionInputKeys(form, model)), true)
})

void test('changing Feishu destination clears a skip from the previous table without clearing real details', () => {
  const state: any = {
    inputKeys: { analysis: 'a', storage: 'old' },
    skippedExisting: true,
    feishuRecordId: 'old-record',
    stages: {
      detail: { status: 'skipped', attempts: 0 },
      storage: { status: 'skipped', attempts: 0 },
    },
  }
  synchronizeCollectionInputs(state, { analysis: 'a', storage: 'new' })
  assert.equal(state.skippedExisting, undefined)
  assert.equal(state.feishuRecordId, undefined)
  assert.equal(state.stages.detail, undefined)
})
