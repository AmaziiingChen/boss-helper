import { createOpenAI } from '@ai-sdk/openai'
import { Output, ToolLoopAgent } from 'ai'
import type { ModelMessage } from 'ai'

import type { FormDataAi } from '@/types/formData'

import type { ModelConf } from '.'
import { renderTemplate } from '../../utils/ai'
import type { WorkflowData } from '../useApplying/type'
import type { HelperContext } from '../useHelper'

const roles = ['filtering', 'greeting'] as const
type MessageRole = (typeof roles)[number]

export class ChatModel {
  agents: Map<MessageRole, [ToolLoopAgent, ModelConf, FormDataAi]> = new Map()
  ctx: HelperContext<any, any, any>

  constructor(ctx: HelperContext<any, any, any>) {
    this.ctx = ctx
  }

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
    // Providers are lightweight configuration objects. Recreate on initialization
    // so editing an existing model's URL or key takes effect on the next run.
    const provider = createOpenAI({
      baseURL: conf.data?.base_url,
      apiKey: conf.data?.api_key,
    })

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
      onStart: () => logger.debug('AI request started', { agentName }),
      onEnd: () => logger.debug('AI request finished', { agentName }),
    })
  }
}
