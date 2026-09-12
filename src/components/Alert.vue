<script setup lang="ts">
import Button from 'primevue/button'
import Message from 'primevue/message'
import { computed, onMounted, ref } from 'vue'

import { counter } from '@/message'

type AlertColor = 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'primary'

export interface ExtendedAlertProps {
  id?: string
  title?: string
  description?: string
  color?: AlertColor
  type?: string
  showIcon?: boolean
  close?: boolean | Record<string, unknown>
  closable?: boolean
  variant?: string
  orientation?: string
  icon?: string | null
  actions?: Array<{
    label: string
    color?: string
    variant?: string
    onClick?: () => void
  }>
}

const props = defineProps<ExtendedAlertProps>()

const storageKey = computed(() => `local:alert:${props.id}`)
const isVisible = ref(true)
const severity = computed<'success' | 'error' | 'warn' | 'info' | 'secondary'>(() => {
  if (props.color === 'warning') return 'warn'
  if (props.color === 'neutral') return 'secondary'
  if (props.color === 'primary') return 'info'
  return props.color ?? 'info'
})
const canClose = computed(() => props.closable !== false && (Boolean(props.close) || Boolean(props.id)))

onMounted(async () => {
  const shouldHide = await counter.storageGet(storageKey.value, false)
  isVisible.value = !shouldHide
})

async function handleClose() {
  await counter.storageSet(storageKey.value, true)
  isVisible.value = false
}
</script>

<template>
  <Message
    v-if="isVisible"
    class="app-alert"
    :severity="severity"
    :closable="canClose"
    @close="handleClose"
  >
    <div class="app-alert-content">
      <strong v-if="title"><slot name="title">{{ title }}</slot></strong>
      <div v-if="description || $slots.description" class="app-alert-description">
        <slot name="description">{{ description }}</slot>
      </div>
      <slot />
      <div v-if="actions?.length" class="app-alert-actions">
        <Button
          v-for="action in actions"
          :key="action.label"
          :label="action.label"
          size="small"
          text
          @click="action.onClick"
        />
      </div>
    </div>
  </Message>
</template>
