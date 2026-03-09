import OpenAI from 'openai'
import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  ContentBlock,
  TokenUsage,
} from '@zero-os/shared'
import { parseChatGptOAuthSession } from '../auth/chatgpt'
import type { ProviderAdapter, AdapterConfig } from './base'

interface ChatGptSseEvent {
  type?: string
  delta?: string
  call_id?: string
  arguments?: string
  item?: Record<string, unknown>
  response?: Record<string, unknown>
}

const DEFAULT_CHATGPT_INSTRUCTIONS = 'You are a helpful assistant.'

/**
 * OpenAI Responses API adapter.
 * Uses the native Responses API (`client.responses.create()`) for models
 * that support it (e.g., o3, o4-mini, gpt-4.1).
 */
export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly apiType = 'openai_responses'
  private client: OpenAI | null
  private modelId: string
  private isChatGptProvider: boolean
  private baseUrl: string
  private oauthToken?: string

  constructor(config: AdapterConfig) {
    this.isChatGptProvider = config.providerName === 'chatgpt'
    this.baseUrl = config.baseUrl
    this.oauthToken = config.oauthToken
    this.client = this.isChatGptProvider
      ? null
      : new OpenAI({
          apiKey: config.apiKey ?? 'dummy',
          baseURL: config.baseUrl.endsWith('/v1')
            ? config.baseUrl
            : `${config.baseUrl}/v1`,
        })
    this.modelId = config.modelConfig.modelId
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (this.isChatGptProvider) {
      return this.completeFromChatGpt(req)
    }

    const input = this.buildInput(req)
    const tools = req.tools ? this.convertTools(req.tools) : undefined

    const response = await (this.client as OpenAI as any).responses.create({
      model: req.model ?? this.modelId,
      input,
      tools,
      max_output_tokens: req.maxTokens,
      stream: false,
    })

    return this.parseResponse(response)
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamEvent> {
    if (this.isChatGptProvider) {
      yield* this.streamFromChatGpt(req)
      return
    }

    const input = this.buildInput(req)
    const tools = req.tools ? this.convertTools(req.tools) : undefined

    const stream = await (this.client as OpenAI as any).responses.create({
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
            model: event.response?.model,
            usage: usage ? this.parseUsage(usage) : undefined,
          },
        }
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    if (this.isChatGptProvider) {
      try {
        const response = await this.completeFromChatGpt({
          messages: [],
          stream: false,
          maxTokens: 5,
          system: 'Respond with pong',
          model: this.modelId,
        })
        return response.content.length > 0 || response.stopReason === 'end_turn'
      } catch {
        return false
      }
    }

    try {
      const response = await (this.client as OpenAI as any).responses.create({
        model: this.modelId,
        input: 'ping',
        max_output_tokens: 5,
      })
      return !!response.id
    } catch {
      try {
        const response = await (this.client as OpenAI).chat.completions.create({
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

  private async completeFromChatGpt(req: CompletionRequest): Promise<CompletionResponse> {
    const events = await this.fetchChatGptEvents(req)
    return this.parseChatGptCompletion(events)
  }

  private async *streamFromChatGpt(req: CompletionRequest): AsyncIterable<StreamEvent> {
    const session = this.getChatGptSession()
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'chatgpt-account-id': session.accountId,
        'OpenAI-Beta': 'responses=experimental',
        originator: 'zero-os',
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify(this.buildChatGptBody(req)),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`ChatGPT request failed: ${response.status} ${error}`)
    }

    const toolCallBuffers = new Map<string, { name: string; arguments: string }>()

    for await (const event of this.iterSseEvents(response)) {
      if (event.type === 'response.output_text.delta') {
        yield { type: 'text_delta', data: { text: event.delta ?? '' } }
      } else if (event.type === 'response.output_item.added') {
        const item = event.item ?? {}
        if (item.type === 'function_call') {
          const callId = typeof item.call_id === 'string' ? item.call_id : undefined
          if (!callId) continue
          const name = typeof item.name === 'string' ? item.name : 'unknown_tool'
          toolCallBuffers.set(callId, { name, arguments: typeof item.arguments === 'string' ? item.arguments : '' })
          yield { type: 'tool_use_start', data: { id: callId, name } }
        }
      } else if (event.type === 'response.function_call_arguments.delta') {
        const callId = typeof event.call_id === 'string' ? event.call_id : undefined
        const delta = event.delta ?? ''
        if (callId && toolCallBuffers.has(callId)) {
          toolCallBuffers.get(callId)!.arguments += delta
        }
        yield { type: 'tool_use_delta', data: { ...(callId ? { id: callId } : {}), arguments: delta } }
      } else if (event.type === 'response.function_call_arguments.done') {
        const callId = typeof event.call_id === 'string' ? event.call_id : undefined
        if (callId && toolCallBuffers.has(callId) && typeof event.arguments === 'string') {
          toolCallBuffers.get(callId)!.arguments = event.arguments
        }
      } else if (event.type === 'response.output_item.done') {
        const item = event.item ?? {}
        if (item.type === 'function_call') {
          const callId = typeof item.call_id === 'string' ? item.call_id : undefined
          if (!callId) continue
          yield { type: 'tool_use_end', data: { id: callId } }
        }
      } else if (event.type === 'response.completed') {
        const usage = event.response?.usage
        yield {
          type: 'done',
          data: {
            finishReason: event.response?.status === 'completed' ? 'stop' : 'tool_calls',
            model: event.response?.model,
            usage: usage ? this.parseUsage(usage) : undefined,
          },
        }
      }
    }
  }

  private buildInput(req: CompletionRequest): any[] {
    const input: any[] = []
    const pairedCallIds = this.collectPairedToolCallIds(req)

    if (req.system) {
      input.push({
        role: 'system',
        content: req.system,
      })
    }

    for (const msg of req.messages) {
      if (msg.role === 'user') {
        const textParts = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n')
        const imageParts = msg.content.filter((b) => b.type === 'image')

        const toolResults = msg.content.filter((b) => b.type === 'tool_result')
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            const result = tr as {
              toolUseId: string
              content: string
              isError?: boolean
              outputSummary?: string
            }
            if (!pairedCallIds.has(result.toolUseId)) continue
            input.push({
              type: 'function_call_output',
              call_id: result.toolUseId,
              output: this.normalizeToolOutput(result.content, result.outputSummary),
            })
          }
        }

        if (textParts || imageParts.length > 0) {
          if (imageParts.length > 0) {
            const parts: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> = []
            if (textParts) parts.push({ type: 'input_text', text: textParts })
            for (const img of imageParts) {
              const { mediaType, data } = img as { mediaType: string; data: string }
              parts.push({ type: 'input_image', image_url: `data:${mediaType};base64,${data}` })
            }
            input.push({ role: 'user', content: parts } as any)
          } else {
            input.push({ role: 'user', content: textParts })
          }
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

        for (const tu of toolUses) {
          const block = tu as { id: string; name: string; input: Record<string, unknown> }
          if (!pairedCallIds.has(block.id)) continue
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

  private buildChatGptBody(req: CompletionRequest) {
    const tools = req.tools ? this.convertTools(req.tools) : undefined

    return {
      model: this.stripChatGptModel(req.model ?? this.modelId),
      store: false,
      stream: true,
      instructions: req.system?.trim() || DEFAULT_CHATGPT_INSTRUCTIONS,
      input: this.buildInput(req),
      ...(tools ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {}),
      text: { verbosity: 'medium' },
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: this.computePromptCacheKey(req),
    }
  }

  private stripChatGptModel(model: string): string {
    return model.startsWith('chatgpt/') ? model.slice('chatgpt/'.length) : model
  }

  private async fetchChatGptEvents(req: CompletionRequest): Promise<ChatGptSseEvent[]> {
    const session = this.getChatGptSession()
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'chatgpt-account-id': session.accountId,
        'OpenAI-Beta': 'responses=experimental',
        originator: 'zero-os',
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify(this.buildChatGptBody(req)),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`ChatGPT request failed: ${response.status} ${error}`)
    }

    const events: ChatGptSseEvent[] = []
    for await (const event of this.iterSseEvents(response)) {
      events.push(event)
    }
    return events
  }

  private async *iterSseEvents(response: Response): AsyncIterable<ChatGptSseEvent> {
    const reader = response.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary === -1) break
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        const data = rawEvent
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
          .trim()

        if (!data || data === '[DONE]') continue

        try {
          yield JSON.parse(data) as ChatGptSseEvent
        } catch {
          continue
        }
      }
    }
  }

  private parseChatGptCompletion(events: ChatGptSseEvent[]): CompletionResponse {
    const textParts: string[] = []
    const toolCalls = new Map<string, { name: string; arguments: string }>()
    let responseId = crypto.randomUUID()
    let responseModel = this.modelId
    let usage: TokenUsage = { input: 0, output: 0 }
    let hasToolUse = false

    for (const event of events) {
      if (event.type === 'response.output_text.delta') {
        textParts.push(event.delta ?? '')
      } else if (event.type === 'response.output_item.added') {
        const item = event.item ?? {}
        if (item.type === 'function_call') {
          const callId = typeof item.call_id === 'string' ? item.call_id : undefined
          if (!callId) continue
          toolCalls.set(callId, {
            name: typeof item.name === 'string' ? item.name : 'unknown_tool',
            arguments: typeof item.arguments === 'string' ? item.arguments : '',
          })
        }
      } else if (event.type === 'response.function_call_arguments.delta') {
        const callId = typeof event.call_id === 'string' ? event.call_id : undefined
        if (callId) {
          const existing = toolCalls.get(callId)
          if (existing) {
            existing.arguments += event.delta ?? ''
          } else {
            toolCalls.set(callId, {
              name: 'unknown_tool',
              arguments: event.delta ?? '',
            })
          }
        }
      } else if (event.type === 'response.function_call_arguments.done') {
        const callId = typeof event.call_id === 'string' ? event.call_id : undefined
        if (callId && typeof event.arguments === 'string') {
          const existing = toolCalls.get(callId)
          if (existing) {
            existing.arguments = event.arguments
          } else {
            toolCalls.set(callId, {
              name: 'unknown_tool',
              arguments: event.arguments,
            })
          }
        }
      } else if (event.type === 'response.output_item.done') {
        const item = event.item ?? {}
        if (item.type === 'function_call') {
          const callId = typeof item.call_id === 'string' ? item.call_id : undefined
          if (!callId) continue
          const existing = toolCalls.get(callId)
          toolCalls.set(callId, {
            name: typeof item.name === 'string' ? item.name : existing?.name ?? 'unknown_tool',
            arguments: typeof item.arguments === 'string' ? item.arguments : existing?.arguments ?? '',
          })
        }
      } else if (event.type === 'response.completed') {
        responseId = typeof event.response?.id === 'string' ? event.response.id : responseId
        responseModel = typeof event.response?.model === 'string' ? event.response.model : responseModel
        usage = this.parseUsage(event.response?.usage)
      }
    }

    const content: ContentBlock[] = []
    if (textParts.join('')) {
      content.push({ type: 'text', text: textParts.join('') })
    }

    for (const [callId, toolCall] of toolCalls) {
      hasToolUse = true
      content.push({
        type: 'tool_use',
        id: callId,
        name: toolCall.name,
        input: this.safeJsonParse(toolCall.arguments),
      })
    }

    return {
      id: responseId,
      content,
      stopReason: hasToolUse ? 'tool_use' : 'end_turn',
      usage,
      model: responseModel,
    }
  }

  private getChatGptSession() {
    const session = parseChatGptOAuthSession(this.oauthToken)
    if (!session) {
      throw new Error('ChatGPT OAuth credentials not found. Please run `bun zero provider login chatgpt`.')
    }
    if (Date.now() >= session.expiresAt - 60_000) {
      throw new Error('ChatGPT OAuth token expired. Please re-authenticate with `bun zero provider login chatgpt`.')
    }
    return session
  }

  private safeJsonParse(value: string): Record<string, unknown> {
    try {
      return JSON.parse(value || '{}') as Record<string, unknown>
    } catch {
      return { raw: value }
    }
  }

  private computePromptCacheKey(req: CompletionRequest): string {
    return Bun.hash(JSON.stringify({
      system: req.system,
      model: req.model ?? this.modelId,
      messages: req.messages,
      tools: req.tools,
    })).toString()
  }

  private collectPairedToolCallIds(req: CompletionRequest): Set<string> {
    const toolUseIds = new Set<string>()
    const toolResultIds = new Set<string>()

    for (const msg of req.messages) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          toolUseIds.add(block.id)
        } else if (block.type === 'tool_result') {
          toolResultIds.add(block.toolUseId)
        }
      }
    }

    const paired = new Set<string>()
    for (const id of toolUseIds) {
      if (toolResultIds.has(id)) {
        paired.add(id)
      }
    }
    return paired
  }

  private normalizeToolOutput(output: string, outputSummary?: string): string {
    if (output.trim().length > 0) return output
    if (outputSummary && outputSummary.trim().length > 0) return outputSummary
    return '[tool completed with empty output]'
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
