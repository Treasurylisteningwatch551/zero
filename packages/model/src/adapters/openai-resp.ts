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
 * Uses the native Responses API (`client.responses.create()`) for models
 * that support it (e.g., o3, o4-mini, gpt-4.1).
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
    const input = this.buildInput(req)
    const tools = req.tools ? this.convertTools(req.tools) : undefined

    const response = await (this.client as any).responses.create({
      model: req.model ?? this.modelId,
      input,
      tools,
      max_output_tokens: req.maxTokens,
      stream: false,
    })

    return this.parseResponse(response)
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    const input = this.buildInput(req)
    const tools = req.tools ? this.convertTools(req.tools) : undefined

    const stream = await (this.client as any).responses.create({
      model: req.model ?? this.modelId,
      input,
      tools,
      max_output_tokens: req.maxTokens,
      stream: true,
    })

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield { type: 'text_delta', data: { text: event.delta } }
      } else if (event.type === 'response.function_call_arguments.delta') {
        yield { type: 'tool_use_delta', data: { arguments: event.delta } }
      } else if (event.type === 'response.completed') {
        const usage = event.response?.usage
        yield {
          type: 'done',
          data: {
            finishReason: event.response?.status === 'completed' ? 'stop' : 'tool_calls',
            usage: usage ? this.parseUsage(usage) : undefined,
          },
        }
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await (this.client as any).responses.create({
        model: this.modelId,
        input: 'ping',
        max_output_tokens: 5,
      })
      return !!response.id
    } catch {
      // Fall back to chat completions health check
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
  }

  private buildInput(req: CompletionRequest): any[] {
    const input: any[] = []

    // System instruction
    if (req.system) {
      input.push({
        role: 'system',
        content: req.system,
      })
    }

    // Conversation messages
    for (const msg of req.messages) {
      if (msg.role === 'user') {
        const textParts = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n')

        // Handle tool results
        const toolResults = msg.content.filter((b) => b.type === 'tool_result')
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            const result = tr as { toolUseId: string; content: string; isError?: boolean }
            input.push({
              type: 'function_call_output',
              call_id: result.toolUseId,
              output: result.content,
            })
          }
        }

        if (textParts) {
          input.push({ role: 'user', content: textParts })
        }
      } else if (msg.role === 'assistant') {
        const textParts = msg.content.filter((b) => b.type === 'text')
        const toolUses = msg.content.filter((b) => b.type === 'tool_use')

        if (textParts.length > 0) {
          input.push({
            role: 'assistant',
            content: textParts.map((b) => (b as { text: string }).text).join('\n'),
          })
        }

        // Function calls are separate output items in Responses API
        for (const tu of toolUses) {
          const block = tu as { id: string; name: string; input: Record<string, unknown> }
          input.push({
            type: 'function_call',
            id: block.id,
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          })
        }
      }
    }

    return input
  }

  private convertTools(tools: CompletionRequest['tools']): any[] | undefined {
    if (!tools || tools.length === 0) return undefined
    return tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }

  private parseResponse(response: any): CompletionResponse {
    const content: ContentBlock[] = []
    let hasToolUse = false

    const output = response.output ?? []
    for (const item of output) {
      if (item.type === 'message') {
        // Text content from message items
        const msgContent = item.content ?? []
        for (const part of msgContent) {
          if (part.type === 'output_text') {
            content.push({ type: 'text', text: part.text })
          }
        }
      } else if (item.type === 'function_call') {
        hasToolUse = true
        content.push({
          type: 'tool_use',
          id: item.call_id ?? item.id,
          name: item.name,
          input: JSON.parse(item.arguments || '{}'),
        })
      }
    }

    // If no message output found, check for top-level output_text
    if (content.length === 0 && response.output_text) {
      content.push({ type: 'text', text: response.output_text })
    }

    const stopReason = hasToolUse
      ? 'tool_use'
      : response.status === 'completed' ? 'end_turn' : 'end_turn'

    return {
      id: response.id,
      content,
      stopReason,
      usage: this.parseUsage(response.usage),
      model: response.model ?? this.modelId,
    }
  }

  private parseUsage(usage?: any): TokenUsage {
    return {
      input: usage?.input_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      cacheWrite: usage?.input_tokens_details?.cached_tokens_details?.cache_creation_input_tokens,
      cacheRead: usage?.input_tokens_details?.cached_tokens,
      reasoning: usage?.output_tokens_details?.reasoning_tokens,
    }
  }
}
