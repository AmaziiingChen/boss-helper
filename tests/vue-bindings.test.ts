import assert from 'node:assert/strict'
import test from 'node:test'

import { ref } from 'vue'

import { getRootVue, useHookVueData, useHookVueFn } from '../src/composables/useVue.ts'

void test('repeated and partial binding retries keep the original getter/setter and notify once per subscriber', async (t) => {
  let value = [1]
  let setterCalls = 0
  const component = Object.defineProperty({}, 'jobList', {
    configurable: true,
    enumerable: true,
    get() {
      return value
    },
    set(next) {
      setterCalls++
      value = next
    },
  }) as any
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => ({ __vue__: component }) },
  })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'document')
  })
  const data = ref<number[]>([])
  let updates = 0
  const bind = useHookVueData('.page', 'jobList', data, () => {
    updates++
  })
  await bind()
  await bind()
  component.jobList = [2, 3]
  assert.equal(updates, 3)
  assert.equal(setterCalls, 1)
  assert.deepEqual(component.jobList, [2, 3])
  assert.deepEqual(data.value, [2, 3])
  assert.equal(await getRootVue(), component)
  component.search = function () {
    return this.jobList.length
  }
  assert.equal((await useHookVueFn('.page', ['missing', 'search'])())(), 2)
  await assert.rejects(useHookVueFn('.page', 'missing')(), /方法不可绑定/)
})

void test('incompatible page fields reject instead of installing a broken setter', async (t) => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => ({ __vue__: {} }) },
  })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'document')
  })
  await assert.rejects(useHookVueData('.page', 'jobList', ref([]))(), /字段不可绑定/)
})
