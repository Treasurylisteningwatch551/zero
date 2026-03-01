import OpenAI from 'openai'
import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  ContentBlock,
  TokenUsage,
} from '@zero-os/shared'
import type { ProviderAdapter, AdapterConfig } from './base'

/**
 * OpenAI Responses API adapter.
 * Used for models that leverage the Responses API (e.g., o3, o4-mini).
 */
export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly apiType = 'openai_responses'
  private client: OpenAI
  private modelId: string

  constructor(config: AdapterConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey ?? 'dummy',
      baseURL: config.baseUrl.endsWith('/v1')
        ? config.baseUrl
        : `${config.baseUrl}/v1`,
    })
    this.modelId = config.modelConfig.modelId
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    // The Responses API uses a different endpoint structure
    // For now, fall back to Chat Completions as a compatibility layer
    const messages = this.convertMessages(req)
    const tools = req.tools ? this.convertTools(req.tools) : undefined

    const response = await this.client.chat.completions.create({
      model: req.model ?? this.modelId,
      messages,
      tools,
      max_tokens: req.maxTokens,
      stream: false,
    })

    const choice = response.choices[0]
    const content: ContentBlock[] = []

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content })
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}'),
        })
      }
    }

    return {
      id: response.id,
      content,
      stopReason: choice.finish_reason === 'stop' ? 'end_turn' : 'tool_use',
      usage: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
        reasoning: (response.usage as Record<string, number>)?.reasoning_tokens,
      },
      model: response.model,
    }
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    const messages = this.convertMessages(req)
    const tools = req.tools ? this.convertTools(req.tools) : undefined

    const stream = await this.client.chat.completions.create({
      model: req.model ?? this.modelId,
      messages,
      tools,
      max_tokens: req.maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) {
        yield { type: 'text_delta', data: { text: delta.content } }
      }

      if (chunk.choices[0]?.finish_reason) {
        yield { type: 'done', data: { finishReason: chunk.choices[0].finish_reason } }
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      })
      return response.choices.length > 0
    } catch {
      return false
    }
  }

  private convertMessages(req: CompletionRequest): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (req.system) {
      messages.push({ role: 'system', content: req.system })
    }
    for (const msg of req.messages) {
      if (msg.role === 'user') {
        const text = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n')
        messages.push({ role: 'user', content: text })
      } else if (msg.role === 'assistant') {
        const text = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n')
        messages.push({ role: 'assistant', content: text })
      }
    }
    return messages
  }

  private convertTools(tools: CompletionRequest['tools']): OpenAI.ChatCompletionTool[] | undefined {
    if (!tools || tools.length === 0) return undefined
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }))
  }
}
