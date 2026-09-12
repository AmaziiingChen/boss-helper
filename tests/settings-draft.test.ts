import assert from 'node:assert/strict'
import test from 'node:test'

import { createDraftState } from '../src/composables/conf/draftState.ts'

test('saving one page excludes another page draft and nested edits stay local', async () => {
  const source = { ai: { enabled: true }, resume: { content: 'saved' } }
  const persist = async (patch: Partial<typeof source>) => {
    Object.assign(source, patch)
  }
  const ai = createDraftState(source, ['ai'], persist)
  const resume = createDraftState(source, ['resume'], persist)
  ai.draft.ai.enabled = false
  resume.draft.resume.content = 'unsaved'
  assert.equal(source.ai.enabled, true)
  await ai.save()
  assert.equal(source.ai.enabled, false)
  assert.equal(source.resume.content, 'saved')
  assert.equal(resume.dirty.value, true)
  assert.equal(ai.dirty.value, false)
})

test('failed persistence retains edits and dirty state', async () => {
  const source = { value: 'saved' }
  const page = createDraftState(source, ['value'], async () => {
    throw new Error('storage unavailable')
  })
  page.draft.value = 'edit'
  await assert.rejects(page.save(), /storage unavailable/)
  assert.equal(page.dirty.value, true)
  assert.equal(page.draft.value, 'edit')
  assert.equal(source.value, 'saved')
  assert.equal(page.saving.value, false)
  page.reset()
  assert.equal(page.dirty.value, false)
})

test('edits made during a save remain unsaved after that save resolves', async () => {
  const source = { value: 'saved' }
  let finish!: () => void
  const page = createDraftState(source, ['value'], async (patch) => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    Object.assign(source, patch)
  })
  page.draft.value = 'first'
  const pending = page.save()
  page.draft.value = 'second'
  finish()
  await pending
  assert.equal(source.value, 'first')
  assert.equal(page.dirty.value, true)
})
