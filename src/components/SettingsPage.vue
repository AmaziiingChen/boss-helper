<script setup lang="ts">
import Button from 'primevue/button'
import Message from 'primevue/message'

withDefaults(
  defineProps<{
    title: string
    dirty: boolean
    saving: boolean
    locked?: boolean
    disabled?: boolean
    error?: string
    status?: string
    contentInert?: boolean
    editor?: boolean
  }>(),
  { locked: false, disabled: false, error: '', status: '', contentInert: false, editor: false },
)
defineEmits<{ save: [] }>()
</script>

<template>
  <section class="prime-settings-stack" :aria-label="title">
    <header class="settings-toolbar">
      <h2>{{ title }}</h2>
      <div class="settings-toolbar-actions" :inert="saving || contentInert">
        <slot name="actions" />
      </div>
    </header>
    <div
      class="settings-page-body"
      :class="{ 'settings-page-body--editor': editor }"
      :inert="saving || contentInert"
    >
      <slot />
    </div>
    <footer class="settings-page-footer">
      <Message v-if="error" severity="error" aria-live="polite">{{ error }}</Message>
      <div class="prime-savebar">
        <span role="status">{{
          saving
            ? '保存中…'
            : locked
              ? '任务运行中，暂停后保存'
              : status || (dirty ? '有未保存的修改' : '无未保存修改')
        }}</span>
        <div class="settings-toolbar-actions">
          <slot name="secondary-actions" />
          <Button
            label="保存"
            icon="pi pi-save"
            :loading="saving"
            :disabled="!dirty || saving || locked || disabled"
            @click="$emit('save')"
          />
        </div>
      </div>
    </footer>
    <slot name="overlays" />
  </section>
</template>
