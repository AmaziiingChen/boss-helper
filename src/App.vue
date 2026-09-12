<script lang="ts" setup>
import Toast from 'primevue/toast'
import { onMounted } from 'vue'

import ProcessingDock from '@/components/Dock/ProcessingDock.vue'
import { useConf } from '@/composables/conf'
import { useModel } from '@/composables/useModel'

const conf = useConf()
const model = useModel()

onMounted(() => {
  void conf.confInit()
  void model.initModel()
})
</script>

<template>
  <Toast position="top-right" />
  <ProcessingDock />
</template>
