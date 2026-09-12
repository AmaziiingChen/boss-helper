import type { OpenAIProvider } from '@ai-sdk/openai'
import { createOpenAI } from '@ai-sdk/openai'
import { Output, ToolLoopAgent } from 'ai'
import type { ModelMessage } from 'ai'

import type { FormDataAi } from '@/types/formData'
import { renderTemplate } from '@/utils/ai'

import type { ModelConf } from '.'
import type { WorkflowData } from '../useApplying/type'
import type { HelperContext } from '../useHelper'

const roles = ['filtering'] as const
type MessageRole = (typeof roles)[number]

export class ChatModel {
  providers: Map<string, OpenAIProvider> = new Map()
  agents: Map<MessageRole, [ToolLoopAgent, ModelConf, FormDataAi]> = new Map()

  constructor(public ctx: HelperContext<any, any, any>) {}

  createAgent(
    model: FormDataAi,
    name: MessageRole,
    opt?: {
      json?: boolean
    },
  ): boolean {
    const conf = this.ctx.models.modelData.value.find((item) => item.key === model.model)
    if (!conf || !model.model) {
      return false
    }
    let provider = this.providers.get(model.model)
    if (!provider) {
      provider = createOpenAI({
        baseURL: conf.data?.base_url,
        apiKey: conf.data?.api_key,
      })
    }
    this.providers.set(model.model, provider)

    const agent = new ToolLoopAgent({
      model: provider.chat(conf.data?.model || 'gpt-4o'),
      // Some OpenAI-compatible providers do not reliably implement JSON response
      // formats. Receive text here and validate the filtering result locally.
      output: Output.text(),
      temperature: opt?.json ? 0 : undefined,
      allowSystemInMessages: true,
    })
    this.agents.set(name, [agent, conf, model])
    return true
  }

  async chat(agentName: MessageRole, data: WorkflowData<any, any>) {
    const configuredAgent = this.agents.get(agentName)
    if (!configuredAgent) {
      throw new Error(`Agent ${agentName} not found`)
    }

    const [agent, , model] = configuredAgent
    const messages: ModelMessage[] =
      typeof model.prompt === 'string'
        ? [{ role: 'user', content: model.prompt } satisfies ModelMessage]
        : jsonClone(model.prompt)

    for (const message of messages) {
      if (typeof message.content === 'string') {
        message.content = renderTemplate(message.content, data)
      }
    }

    return agent.stream({
      timeout: 60000,
      messages,
      onStart: (message) => {
        logger.debug('AI request started', message)
      },
      onStepStart: (message) => {
        logger.debug('AI request step started', message)
      },
      onStepEnd: (message) => {
        logger.debug('AI request step finished', message)
      },
      onEnd: (message) => {
        logger.debug('AI request finished', message)
      },
    })
  }
}
