export type LLMConf<M extends string, T> = { mode: M } & T

export type FormElm =
  | { type: 'input'; config?: Record<string, unknown>; format?: 'url' | 'json' | 'avatar' }
  | {
      type: 'input'
      format: 'number'
      config?: Record<string, unknown>
    }

type IsStructuredObject<T> =
  T extends Record<string, any> ? (string extends keyof T ? false : true) : false

export type LLMInfoValM<T, F extends object> = {
  value: { [K in keyof F]: LLMInfoValF<T, F[K]> }
  label?: string
  desc?: string
  alert: 'success' | 'warning' | 'info' | 'error'
}

export type LLMInfoValF<_T, F> = {
  value?: F
  label?: string
  desc?: string
} & FormElm &
  (undefined extends F ? { required?: boolean } : { required: true })

export type LLMInfoVal<T, F> =
  IsStructuredObject<F> extends true ? LLMInfoValM<T, Extract<F, object>> : LLMInfoValF<T, F>

export type LLMInfo<T extends object> = {
  [K in keyof T]-?: K extends 'mode'
    ? {
        mode: T[K]
        label: string
        icon?: string
        desc?: string
        disabled?: boolean
      }
    : LLMInfoVal<T, T[K]>
}
