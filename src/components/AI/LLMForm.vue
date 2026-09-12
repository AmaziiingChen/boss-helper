<script lang="ts" setup>
import FloatLabel from 'primevue/floatlabel'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'

import type { ModelConfData } from '@/composables/useModel'

const formData = defineModel<ModelConfData>({ required: true })
</script>

<template>
  <div class="openai-form model-connection-form">
    <FloatLabel variant="on">
      <InputText id="model-base-url" v-model="formData.base_url" autocomplete="url" fluid />
      <label for="model-base-url">Base URL</label>
    </FloatLabel>

    <FloatLabel variant="on">
      <Password
        input-id="model-api-key"
        v-model="formData.api_key"
        :feedback="false"
        toggle-mask
        autocomplete="off"
        fluid
      />
      <label for="model-api-key">API Key</label>
    </FloatLabel>

    <FloatLabel variant="on">
      <InputText id="model-id" v-model="formData.model" autocomplete="off" fluid />
      <label for="model-id">Model</label>
    </FloatLabel>
  </div>
</template>
