import Aura from '@primeuix/themes/aura'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import { createApp } from 'vue'

import 'primeicons/primeicons.css'
import '@/assets/main.css'
import App from '@/App.vue'
import { HelperKey } from '@/composables/useHelper'
import { BossHelperCtx } from '@/entrypoints/boss'
import { initExtensionPageCounter } from '@/message'
import { connectSidepanelWorkflow } from '@/message/sidepanelWorkflow'

async function mountSidePanel() {
  initExtensionPageCounter()
  const ctx = await BossHelperCtx.new()
  const disconnect = connectSidepanelWorkflow(ctx, browser)
  window.addEventListener('pagehide', disconnect, { once: true })
  const app = createApp(App)
  app.use(PrimeVue, {
    theme: {
      preset: Aura,
    },
  })
  app.directive('tooltip', Tooltip)
  app.provide(HelperKey, ctx)
  app.mount('#app')
}

void mountSidePanel()
