import Anthropic from '@anthropic-ai/sdk'
import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  ContentBlock,
  TokenUsage,
} from '@zero-os/shared'
import type { ProviderAdapter, AdapterConfig } from './base'

/**
 * Anthropic Messages API adapter.
 * Supports Claude model family.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly apiType = 'anthropic_messages'
  private client: Anthropic
  private modelId: string

  constructor(config: AdapterConfig) {
    this.client = new Anthropic({
      apiKey: config.oauthToken ? null : (config.apiKey ?? 'dummy'),
      authToken: config.oauthToken ?? null,
      baseURL: config.baseUrl,
      ...(config.oauthToken && {
        defaultHeaders: {
          'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
          'user-agent': 'claude-cli/0.0.0 (external, cli)',
          'x-app': 'cli',
        },
      }),
    })
    this.modelId = config.modelConfig.modelId
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.messages.create({
      model: req.model ?? this.modelId,
      system: req.system,
      messages: this.convertMessages(req),
      tools: req.tools ? this.convertTools(req.tools) : undefined,
      max_tokens: req.maxTokens ?? 4096,
    })

    return {
      id: response.id,
      content: this.parseContent(response.content),
      stopReason: this.mapStopReason(response.stop_reason),
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheWrite: (response.usage as Record<string, number>).cache_creation_input_tokens,
        cacheRead: (response.usage as Record<string, number>).cache_read_input_tokens,
      },
      model: response.model,
    }
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    const stream = this.client.messages.stream({
      model: req.model ?? this.modelId,
      system: req.system,
      messages: this.convertMessages(req),
      tools: req.tools ? this.convertTools(req.tools) : undefined,
      max_tokens: req.maxTokens ?? 4096,
    })

    let streamModel: string | undefined
    let streamUsage: TokenUsage | undefined
    let streamStopReason: string | undefined

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown>
        if (delta.type === 'text_delta') {
          yield { type: 'text_delta', data: { text: delta.text } }
        } else if (delta.type === 'input_json_delta') {
          yield { type: 'tool_use_delta', data: { arguments: delta.partial_json } }
        }
      } else if (event.type === 'content_block_start') {
        const block = event.content_block as Record<string, unknown>
        if (block.type === 'tool_use') {
          yield {
            type: 'tool_use_start',
            data: { id: block.id, name: block.name },
          }
        }
      } else if (event.type === 'content_block_stop') {
        yield { type: 'tool_use_end', data: {} }
      } else if (event.type === 'message_start') {
        const msg = (event as any).message
        if (msg?.model) {
          streamModel = msg.model
        }
        if (msg?.usage) {
          streamUsage = {
            input: msg.usage.input_tokens ?? 0,
            output: msg.usage.output_tokens ?? 0,
            cacheWrite: msg.usage.cache_creation_input_tokens,
            cacheRead: msg.usage.cache_read_input_tokens,
          }
        }
      } else if (event.type === 'message_delta') {
        const delta = event as any
        if (delta.delta?.stop_reason) {
          streamStopReason = delta.delta.stop_reason
        }
        if (delta.usage?.output_tokens) {
          streamUsage = {
            ...streamUsage,
            input: streamUsage?.input ?? 0,
            output: delta.usage.output_tokens,
          }
        }
      } else if (event.type === 'message_stop') {
        yield { type: 'done', data: { model: streamModel, usage: streamUsage, finishReason: streamStopReason } }
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.messages.create({
        model: this.modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      })
      return response.content.length > 0
    } catch {
      return false
    }
  }

  private convertMessages(req: CompletionRequest): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = []

    for (const msg of req.messages) {
      if (msg.role === 'user') {
        const parts: Anthropic.ContentBlockParam[] = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text })
          } else if (block.type === 'image') {
            parts.push({
              type: 'image',
              source: { type: 'base64', media_type: block.mediaType as any, data: block.data },
            })
          } else if (block.type === 'tool_result') {
            parts.push({
              type: 'tool_result',
              tool_use_id: block.toolUseId,
              content: block.content,
              is_error: block.isError,
            })
          }
        }
        messages.push({ role: 'user', content: parts })
      } else if (msg.role === 'assistant') {
        const parts: Anthropic.ContentBlockParam[] = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text })
          } else if (block.type === 'tool_use') {
            parts.push({
              type: 'tool_use',
              id: block.id,
              name: block.name,
              input: block.input,
            })
          }
        }
        messages.push({ role: 'assistant', content: parts })
      }
    }

    return messages
  }

  private convertTools(tools: CompletionRequest['tools']): Anthropic.Tool[] | undefined {
    if (!tools || tools.length === 0) return undefined
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }))
  }

  private parseContent(content: Anthropic.ContentBlock[]): ContentBlock[] {
    return content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text }
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }
      }
      return { type: 'text' as const, text: JSON.stringify(block) }
    })
  }

  private mapStopReason(reason: string | null): CompletionResponse['stopReason'] {
    switch (reason) {
      case 'end_turn':
        return 'end_turn'
      case 'tool_use':
        return 'tool_use'
      case 'max_tokens':
        return 'max_tokens'
      default:
        return 'end_turn'
    }
  }
}
