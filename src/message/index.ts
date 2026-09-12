import type { StorageLikeAsync } from '@vueuse/core'
import type { Adapter, Message, OnMessage, SendMessage } from 'comctx'
import { defineProxy } from 'comctx'

import type { BackgroundCounter } from './background'
import type { ContentCounter } from './contentScript'
import { ProvideContentScriptAdapter } from './contentScriptShare'

export const InjectAdapter = ProvideContentScriptAdapter

type CounterFacade = Pick<
  ContentCounter,
  'request' | 'notify' | 'storageGet' | 'storageSet' | 'storageRm'
>

let _counter: CounterFacade | null = null

interface ExtensionPageMessageMeta {
  url: string
  injector: 'popup'
}

class ExtensionPageAdapter implements Adapter<ExtensionPageMessageMeta> {
  private readonly browser: any

  constructor(browser: any) {
    this.browser = browser
  }

  sendMessage: SendMessage<ExtensionPageMessageMeta> = (message) => {
    void this.browser.runtime.sendMessage(this.browser.runtime.id, {
      ...message,
      meta: { url: location.href, injector: 'popup' },
    } satisfies Message<ExtensionPageMessageMeta>)
  }

  onMessage: OnMessage<ExtensionPageMessageMeta> = (callback) => {
    const handler = (message?: Partial<Message<ExtensionPageMessageMeta>>) => callback(message)
    this.browser.runtime.onMessage.addListener(handler)
    return () => this.browser.runtime.onMessage.removeListener(handler)
  }
}

class ExtensionPageCounter implements BackgroundCounter {
  private readonly background: BackgroundCounter
  private readonly browser: any

  constructor(background: BackgroundCounter, browser: any) {
    this.background = background
    this.browser = browser
  }

  async request(...args: Parameters<BackgroundCounter['request']>) {
    return this.background.request(...args)
  }

  async notify(...args: Parameters<BackgroundCounter['notify']>) {
    return this.background.notify(...args)
  }

  private getStorageArea(key: string) {
    const matched = key.match(/^(local|session|sync|managed):(.*)$/)
    return {
      area: matched?.[1] ?? 'sync',
      key: matched?.[2] ?? key,
    }
  }

  async storageGet<T>(key: string, defaultValue: T): Promise<T>
  async storageGet<T>(key: string): Promise<T | null>
  async storageGet<T>(key: string, defaultValue?: T): Promise<T | null> {
    const target = this.getStorageArea(key)
    const data = await this.browser.storage[target.area].get(target.key)
    return data[target.key] ?? defaultValue ?? null
  }

  async storageSet<T>(key: string, value: T) {
    const target = this.getStorageArea(key)
    await this.browser.storage[target.area].set({ [target.key]: value })
    return true
  }

  async storageRm(key: string) {
    const target = this.getStorageArea(key)
    await this.browser.storage[target.area].remove(target.key)
    return true
  }
}

export function initCounter(
  script: HTMLScriptElement = document.currentScript as HTMLScriptElement,
) {
  const [, injectCounter] = defineProxy(() => ({}) as ContentCounter, {
    namespace: '__boss-helper-content__',
  })
  _counter = injectCounter(new InjectAdapter(script))
}

/** Initialize the same storage/request facade for extension-owned pages. */
export function initExtensionPageCounter(browser?: any) {
  const extensionApi =
    browser ??
    (globalThis as typeof globalThis & { browser?: any; chrome?: any }).browser ??
    (globalThis as typeof globalThis & { browser?: any; chrome?: any }).chrome

  if (!extensionApi) {
    throw new Error('Extension API is unavailable in this page.')
  }

  const [, injectBackgroundCounter] = defineProxy(() => ({}) as BackgroundCounter, {
    namespace: '__boss-helper-background__',
  })
  const background = injectBackgroundCounter(new ExtensionPageAdapter(extensionApi))
  _counter = new ExtensionPageCounter(background, extensionApi)
}

export const counter = new Proxy({} as ContentCounter, {
  get(_, key) {
    if (!_counter) {
      throw new Error(
        `Counter has not been initialized. Call initCounter() before using counter.${String(key)}`,
      )
    }

    const value = (_counter as any)[key]

    if (typeof value === 'function') {
      return value.bind(_counter)
    }

    return value
  },

  set(_, key, value) {
    if (!_counter) {
      throw new Error(
        `Counter has not been initialized. Call initCounter() before using counter.${String(key)}`,
      )
    }

    ;(_counter as any)[key] = value
    return true
  },
})

export const ExtStorage: StorageLikeAsync = {
  async getItem(key) {
    return new Promise((resolve) => {
      const t = setInterval(() => {
        if (_counter) {
          void counter.storageGet(key).then((value) => {
            return resolve(value as never)
          })
          clearInterval(t)
        }
      }, 200)
    })
  },
  async setItem(key, value) {
    await counter.storageSet(key, value)
  },
  async removeItem(key) {
    await counter.storageRm(key)
  },
}
