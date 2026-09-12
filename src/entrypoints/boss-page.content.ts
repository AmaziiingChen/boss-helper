import { defineProxy } from 'comctx'

import { browser, defineContentScript } from '#imports'
import { BackgroundCounter, InjectBackgroundAdapter } from '@/message/background'
import { ContentCounter } from '@/message/contentScript'
import { ProvideContentScriptAdapter } from '@/message/contentScriptShare'
import { workflowChannel, workflowCommands } from '@/message/workflowBridge'

export default defineContentScript({
  matches: ['*://zhipin.com/*', '*://*.zhipin.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const script = document.createElement('script')
    script.src = browser.runtime.getURL('/boss.js')
    const [, injectBackground] = defineProxy(() => new BackgroundCounter(), {
      namespace: '__boss-helper-background__',
    })
    const [provideContent] = defineProxy(
      () => new ContentCounter(injectBackground(new InjectBackgroundAdapter())),
      { namespace: '__boss-helper-content__' },
    )
    provideContent(new ProvideContentScriptAdapter(script))

    const listener = (message: any, sender: any, respond: (value: any) => void) => {
      if (
        sender.id !== browser.runtime.id ||
        message?.channel !== workflowChannel ||
        !workflowCommands.includes(message.command)
      )
        return
      const id = crypto.randomUUID()
      const finish = (value: any) => {
        clearTimeout(timer)
        script.removeEventListener(`${workflowChannel}:response`, receive)
        respond(value)
      }
      const receive = (event: Event) => {
        const result = JSON.parse((event as CustomEvent<string>).detail)
        if (result.id === id) finish(result)
      }
      const timer = setTimeout(
        () => finish({ error: '页面采集服务未就绪，请刷新 BOSS 岗位列表页' }),
        10000,
      )
      script.addEventListener(`${workflowChannel}:response`, receive)
      script.dispatchEvent(
        new CustomEvent(`${workflowChannel}:request`, {
          detail: JSON.stringify({
            id,
            command: message.command,
            key: message.key,
            confirmed: message.confirmed,
          }),
        }),
      )
      return true
    }
    browser.runtime.onMessage.addListener(listener)
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(listener))
    document.documentElement.append(script)
  },
})
