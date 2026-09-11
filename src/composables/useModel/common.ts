import type { LLMInfo } from './type'

export interface other {
  other: {
    timeout?: number
  }
}

export const other: LLMInfo<other>['other'] = {
  value: {
    timeout: {
      value: 18000,
      type: 'input',
      format: 'number',
      desc: 'GPT请求的超时时间,超时后不会进行重试将跳过岗位,默认18000s / 30分钟',
    },
  },
  alert: 'warning',
  label: '其他配置',
}
