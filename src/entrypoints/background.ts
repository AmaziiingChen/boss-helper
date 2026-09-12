import { defineProxy } from 'comctx'

import { defineBackground } from '#imports'
import { BackgroundCounter, ProvideBackgroundAdapter } from '@/message/background'

export default defineBackground({
  main() {
    const [provideBackgroundCounter] = defineProxy(() => new BackgroundCounter(), {
      namespace: '__boss-helper-background__',
    })

    provideBackgroundCounter(new ProvideBackgroundAdapter())

    const sidePanel = (browser as typeof browser & { sidePanel?: typeof browser.sidePanel })
      .sidePanel
    if (sidePanel) {
      void sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    }
  },
})
