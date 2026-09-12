import type { Adapter, Message, OnMessage, SendMessage } from 'comctx'

import type { Browser } from '#imports'
import { browser } from '#imports'

export class BackgroundCounter {
  async request(args: {
    url: string
    data: RequestInit
    timeout: number
    responseType: 'text' | 'json'
  }) {
    console.log('request', { url: args.url, method: args.data.method })
    const signal = AbortSignal.timeout(args.timeout * 1000)

    const res = await fetch(args.url, {
      ...args.data,
      signal,
      mode: 'cors',
      credentials: 'include',
    }).then(async (res) => {
      console.log('request response', { url: args.url, status: res.status })

      if (!res.ok || res.status >= 400) {
        const errorText = await res.text()
        throw new Error(`状态码: ${res.status}: ${errorText}`)
      }

      const result = args.responseType === 'json' ? await res.json() : await res.text()

      return result
    })
    return res
  }

  async notify(args: Browser.notifications.NotificationCreateOptions) {
    await browser.notifications.create({
      type: args.type,
      iconUrl: args.iconUrl,
      title: args.title,
      message: args.message,
    })
    return true
  }
}

interface MessageMeta {
  url: string
  injector: 'content' | 'popup'
  tabId?: number
}

export class ProvideBackgroundAdapter implements Adapter<MessageMeta> {
  sendMessage: SendMessage<MessageMeta> = async (message) => {
    switch (message.meta.injector) {
      case 'content': {
        if (message.meta.tabId !== undefined) {
          await browser.tabs.sendMessage(message.meta.tabId, message)
        }
        break
      }
      case 'popup': {
        await browser.runtime.sendMessage(message).catch((error) => {
          if (error.message.includes('Receiving end does not exist')) {
            return
          }
          throw error
        })
        break
      }
    }
  }
  onMessage: OnMessage<MessageMeta> = (callback) => {
    const handler = (
      message: Partial<Message<MessageMeta>> | undefined,
      sender: Browser.runtime.MessageSender,
    ) => {
      if (!message?.meta) {
        return callback(message)
      }
      callback({
        ...message,
        meta: {
          ...message.meta,
          injector: sender.tab ? 'content' : 'popup',
          tabId: sender.tab?.id,
        },
      })
    }
    browser.runtime.onMessage.addListener(handler)
    return () => browser.runtime.onMessage.removeListener(handler)
  }
}

export class InjectBackgroundAdapter implements Adapter<MessageMeta> {
  constructor(public name: MessageMeta['injector'] = 'content') {}
  sendMessage: SendMessage<MessageMeta> = (message) => {
    void browser.runtime.sendMessage(browser.runtime.id, {
      ...message,
      meta: { url: document.location.href, injector: this.name },
    } satisfies Message<MessageMeta>)
  }
  onMessage: OnMessage<MessageMeta> = (callback) => {
    const handler = (message?: Partial<Message<MessageMeta>>) => {
      callback(message)
    }
    browser.runtime.onMessage.addListener(handler)
    return () => browser.runtime.onMessage.removeListener(handler)
  }
}
