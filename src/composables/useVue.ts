import type { Ref } from 'vue'
import { toValue } from 'vue'

function waitForVue(selectors: string): Promise<any> {
  return new Promise((resolve, reject) => {
    let interval: ReturnType<typeof setInterval>
    let timeout: ReturnType<typeof setTimeout>
    const check = () => {
      const component = document.querySelector<any>(selectors)?.__vue__
      if (!component) return
      clearInterval(interval)
      clearTimeout(timeout)
      resolve(component)
      return true
    }
    if (check()) return
    interval = setInterval(check, 100)
    timeout = setTimeout(() => {
      clearInterval(interval)
      reject(new Error(`未找到 BOSS 页面组件：${selectors}`))
    }, 20000)
  })
}

export const getRootVue = () => waitForVue('#wrap')

type Listener = { data: Ref<any>; update?: (value: any) => void }
const hooks = new WeakMap<object, Map<string, Map<Ref<any>, Listener>>>()

export function useHookVueData<T = any>(
  selectors: string,
  key: string,
  data: Ref<T>,
  update?: (val: T) => void,
) {
  return async () => {
    const component = await waitForVue(selectors)
    let entries = hooks.get(component)
    if (!entries) hooks.set(component, (entries = new Map()))
    let listeners = entries.get(key)
    if (!listeners) {
      const descriptor = Object.getOwnPropertyDescriptor(component, key)
      if (
        !descriptor ||
        descriptor.configurable === false ||
        (descriptor.get && !descriptor.set) ||
        descriptor.writable === false
      )
        throw new Error(`BOSS 页面字段不可绑定：${key}`)
      listeners = new Map()
      const subscribers = listeners
      let value = component[key]
      Object.defineProperty(component, key, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          return descriptor.get ? descriptor.get.call(this) : value
        },
        set(next: T) {
          if (descriptor.set) descriptor.set.call(this, next)
          else value = next
          for (const listener of subscribers.values()) {
            listener.data.value = next
            listener.update?.(next)
          }
        },
      })
      entries.set(key, listeners)
    }
    listeners.set(data, { data, update })
    data.value = component[key]
    update?.(toValue(component[key] as T))
  }
}

export function useHookVueFn(selectors: string, key: string | string[]) {
  return async () => {
    const component = await waitForVue(selectors)
    const keys = Array.isArray(key) ? key : [key]
    for (const name of keys) {
      if (typeof component[name] === 'function') return component[name].bind(component)
    }
    throw new Error(`BOSS 页面方法不可绑定：${keys.join(' / ')}`)
  }
}
