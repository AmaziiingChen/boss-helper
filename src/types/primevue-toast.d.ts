declare module 'primevue/toasteventbus' {
  interface ToastMessage {
    severity?: string
    summary?: string
    detail?: string
    life?: number
    [key: string]: unknown
  }

  const ToastEventBus: {
    emit(event: 'add', message: ToastMessage): void
    emit(event: 'remove', message: ToastMessage): void
    emit(event: 'remove-group', group: string): void
    emit(event: 'remove-all-groups'): void
  }

  export default ToastEventBus
}
