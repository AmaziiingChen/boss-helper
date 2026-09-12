import { createOpenAI } from '@ai-sdk/openai'

import type { LLMConf, LLMInfo } from './type'

export type OpenaiLLMConf = LLMConf<
  'openai',
  {
    base_url: string
    api_key: string
    model: string
  }
>

const info: LLMInfo<OpenaiLLMConf> = {
  mode: {
    mode: 'openai',
    label: 'OpenAI',
  },
  base_url: {
    desc: '可使用中转/代理API, 前提是符合openai的规范, 需要填写base api地址',
    type: 'input',
    config: {
      placeholder: 'https://api.openai.com/v1',
      items: [
        'https://api.openai.com/v1',
        'https://openrouter.ai/api/v1',
        'https://api.deepseek.com',
        'https://api.moonshot.cn/v1',
        'https://token-plan-sgp.xiaomimimo.com/v1',
        'https://ark.cn-beijing.volces.com/api/v3',
      ],
      createItem: 'always',
    },
    required: true,
  },
  api_key: { type: 'input', required: true },
  model: {
    config: {
      placeholder: 'gpt-4o-mini',
      items: [
        'gpt-4o',
        'gpt-5.4',
        'deepseek-chat',
        'doubao-seed-2-0-pro-260215',
        'mimo-v2.5-pro',
        'mimo-v2.5',
        'kimi-k2.6',
        'deepseek-v4-flash',
        'minimax-m2.7',
        'deepseek-v3.2',
      ],
      createItem: 'always',
    },
    value: 'deepseek-chat',
    type: 'input',
    required: true,
  },
}

const createModel = (conf: OpenaiLLMConf) => {
  const openai = createOpenAI({
    baseURL: conf.base_url,
    apiKey: conf.api_key,
  })
  return openai.chat(conf.model)
}

export const openai = {
  createModel,
  info,
}
