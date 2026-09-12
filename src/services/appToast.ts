import ToastEventBus from 'primevue/toasteventbus'

export interface AppToastMessage {
  title?: string
  description?: string
  color?: 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'primary'
  duration?: number
  timeout?: number
}

function severity(color: AppToastMessage['color']) {
  if (color === 'warning') return 'warn'
  if (color === 'neutral') return 'secondary'
  if (color === 'primary') return 'info'
  return color ?? 'info'
}

const appToast = {
  add(message: AppToastMessage) {
    ToastEventBus.emit('add', {
      severity: severity(message.color),
      summary: message.title,
      detail: message.description,
      life: message.duration ?? message.timeout ?? 5000,
    })
  },
}

export function useAppToast() {
  return appToast
}
