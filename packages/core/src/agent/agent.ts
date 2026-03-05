import type {
  Message,
  ContentBlock,
  CompletionRequest,
  CompletionResponse,
  ToolContext,
  ToolResult,
  ToolDefinition,
  TokenUsage,
  SecretFilter,
} from '@zero-os/shared'
import { generateId, generatePrefixedId, now } from '@zero-os/shared'
import type { ProviderAdapter } from '@zero-os/model'
import { computeCost } from '@zero-os/model'
import type { BaseTool } from '../tool/base'
import type { ToolRegistry } from '../tool/registry'
import type { JsonlLogger, MetricsDB, Tracer } from '@zero-os/observe'
import { truncateToolOutput } from './truncate'
import { prepareConversationHistory, estimateConversationTokens } from './context'
import { allocateBudget, shouldCompress } from './budget'
import { type QueuedMessage, injectQueuedMessages, CONTINUATION_PROMPT, isTaskComplete } from './queue'
import { CONTEXT_PARAMS } from './params'

class ToolInputParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputParseError'
  }
}

export interface AgentConfig {
  name: string
  systemPrompt: string
  identityMemory?: string
}

export interface AgentContext {
  systemPrompt: string
  identityMemory?: string
  retrievedMemories?: string[]
  /** Dynamic context (<system-reminder>) injected into user message for the API only, not stored. */
  dynamicContext?: string
  conversationHistory: Message[]
  tools: ToolDefinition[]
  maxContext?: number
  maxOutput?: number
}

/**
 * Optional observability dependencies for the agent.
 */
export interface AgentObservability {
  logger?: JsonlLogger
  metrics?: MetricsDB
  tracer?: Tracer
  secretFilter?: SecretFilter
  bus?: {
    emit(topic: string, data: Record<string, unknown>): void
  }
  /** Provider name for logging, e.g. "openai-codex" */
  providerName?: string
  /** ModelPricing from config for cost calculation */
  pricing?: import('@zero-os/shared').ModelPricing
}

/**
 * Agent execution engine — runs the tool use loop.
 */
export class Agent {
  private config: AgentConfig
  private adapter: ProviderAdapter
  private toolRegistry: ToolRegistry
  private toolContext: ToolContext
  private obs: AgentObservability

  constructor(
    config: AgentConfig,
    adapter: ProviderAdapter,
    toolRegistry: ToolRegistry,
    toolContext: ToolContext,
    obs: AgentObservability = {}
  ) {
    this.config = config
    this.adapter = adapter
    this.toolRegistry = toolRegistry
    this.toolContext = toolContext
    this.obs = obs
  }

  /**
   * Run the agent's tool-use loop until completion or max loops reached.
   */
  async run(
    context: AgentContext,
    userMessage: string,
    userImages?: Array<{ mediaType: string; data: string }>,
    onNewMessage?: (msg: Message) => void,
    onTextDelta?: (delta: string, meta: { role: 'assistant'; turnId: string }) => void,
    shouldInterrupt?: () => boolean,
    getQueuedMessages?: () => QueuedMessage[]
  ): Promise<Message[]> {
    let continuationCount = 0
    const messages: Message[] = [...prepareConversationHistory(context.conversationHistory)]
    const newMessages: Message[] = []

    // Start root trace span
    const rootSpan = this.obs.tracer?.startSpan(
      this.toolContext.sessionId,
      `agent.run:${this.config.name}`
    )

    // Add user message (text + optional images)
    const userContent: ContentBlock[] = [{ type: 'text', text: userMessage }]
    if (userImages?.length) {
      for (const img of userImages) {
        userContent.push({ type: 'image', mediaType: img.mediaType, data: img.data })
      }
    }
    const userMsg: Message = {
      id: generateId(),
      sessionId: this.toolContext.sessionId,
      role: 'user',
      messageType: 'message',
      content: userContent,
      createdAt: now(),
    }
    newMessages.push(userMsg)
    onNewMessage?.(userMsg)

    // Inject dynamic context into API copy only — stored message stays clean
    if (context.dynamicContext) {
      const enrichedContent: ContentBlock[] = [
        { type: 'text', text: context.dynamicContext },
        ...userContent,
      ]
      messages.push({ ...userMsg, content: enrichedContent })
    } else {
      messages.push(userMsg)
    }

    // Build system prompt (retrieved memories are already in XML System Prompt if using structured builder)
    const systemParts: string[] = [context.systemPrompt]
    if (context.identityMemory) systemParts.push(context.identityMemory)
    const system = systemParts.join('\n\n')

    let hadQueuedMessages = false

    while (true) {
      const request: CompletionRequest = {
        messages,
        tools: context.tools,
        system,
        stream: true,
        maxTokens: context.maxOutput ?? 16384,
      }

      const llmStart = Date.now()
      const response = await this.completeWithStreamFallback(request, onTextDelta)
      const llmDurationMs = Date.now() - llmStart

      // Log LLM request to observability
      this.logLLMRequest(response, userMessage, llmDurationMs)

      // Create assistant message — filter secrets from text blocks
      const filteredContent = this.filterContent(response.content)

      const assistantMsg: Message = {
        id: generateId(),
        sessionId: this.toolContext.sessionId,
        role: 'assistant',
        messageType: 'message',
        content: filteredContent,
        model: response.model,
        createdAt: now(),
      }
      messages.push(assistantMsg)
      newMessages.push(assistantMsg)
      onNewMessage?.(assistantMsg)

      // Emit session update event
      this.obs.bus?.emit('session:update', {
        sessionId: this.toolContext.sessionId,
        event: 'assistant_response',
        model: response.model,
      })

      // If no tool use, check if continuation is needed after queued message response
      if (response.stopReason !== 'tool_use') {
        if (hadQueuedMessages && !isTaskComplete(response.content) && continuationCount < CONTEXT_PARAMS.queue.maxContinuationRetries) {
          // Task not complete after responding to queued messages — inject continuation prompt
          const contMsg: Message = {
            id: generateId(),
            sessionId: this.toolContext.sessionId,
            role: 'user',
            messageType: 'message',
            content: [{ type: 'text', text: CONTINUATION_PROMPT }],
            createdAt: now(),
          }
          messages.push(contMsg)
          newMessages.push(contMsg)
          continuationCount++
          hadQueuedMessages = false
          continue
        }
        break
      }

      // Process tool calls
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use')
      const toolResultBlocks: ContentBlock[] = []

      for (const block of toolUseBlocks) {
        if (block.type !== 'tool_use') continue
        const tool = this.toolRegistry.get(block.name)

        // Emit tool:call event
        this.obs.bus?.emit('tool:call', {
          sessionId: this.toolContext.sessionId,
          tool: block.name,
          toolUseId: block.id,
        })

        // Start tool trace span
        const toolSpan = this.obs.tracer?.startSpan(
          this.toolContext.sessionId,
          `tool:${block.name}`,
          rootSpan?.id
        )

        // Detect malformed tool input (truncated by max_tokens)
        if (block.type === 'tool_use' && block.input && typeof (block.input as Record<string, unknown>).__parse_error === 'string') {
          const parseError = (block.input as Record<string, unknown>).__parse_error as string
          toolResultBlocks.push({
            type: 'tool_result',
            toolUseId: block.id,
            content: `Tool input JSON was malformed (likely truncated by max_tokens). ${parseError}. Please retry with shorter content or split into multiple calls.`,
            isError: true,
          })
          if (toolSpan) this.obs.tracer?.endSpan(toolSpan.id, 'error')
          this.obs.bus?.emit('tool:result', {
            sessionId: this.toolContext.sessionId,
            tool: block.name,
            success: false,
            error: parseError,
          })
          continue
        }

        if (!tool) {
          toolResultBlocks.push({
            type: 'tool_result',
            toolUseId: block.id,
            content: `Unknown tool: ${block.name}`,
            isError: true,
          })
          if (toolSpan) this.obs.tracer?.endSpan(toolSpan.id, 'error')
          this.obs.bus?.emit('tool:result', {
            sessionId: this.toolContext.sessionId,
            tool: block.name,
            success: false,
            error: `Unknown tool: ${block.name}`,
          })
          continue
        }

        let result: ToolResult
        try {
          result = await tool.run(this.toolContext, block.input)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          result = {
            success: false,
            output: errorMessage,
            outputSummary: `Tool execution failed: ${errorMessage.slice(0, 100)}`,
          }
        }

        if (toolSpan) {
          this.obs.tracer?.endSpan(toolSpan.id, result.success ? 'success' : 'error', {
            outputSummary: result.outputSummary,
          })
        }

        // Emit tool:result event
        this.obs.bus?.emit('tool:result', {
          sessionId: this.toolContext.sessionId,
          tool: block.name,
          success: result.success,
          outputSummary: result.outputSummary,
        })

        const truncatedOutput = truncateToolOutput(block.name, result.output)
        toolResultBlocks.push({
          type: 'tool_result',
          toolUseId: block.id,
          content: truncatedOutput,
          isError: !result.success,
          outputSummary: result.outputSummary,
        })
      }

      // Add tool results as user message
      if (toolResultBlocks.length > 0) {
        const toolResultMsg: Message = {
          id: generateId(),
          sessionId: this.toolContext.sessionId,
          role: 'user',
          messageType: 'message',
          content: toolResultBlocks,
          createdAt: now(),
        }
        messages.push(toolResultMsg)
        newMessages.push(toolResultMsg)
        onNewMessage?.(toolResultMsg)
      }

      // Budget check + compression
      if (context.maxContext && context.maxOutput) {
        const budget = allocateBudget(context.maxContext, context.maxOutput)
        if (shouldCompress(estimateConversationTokens(messages), budget.conversation)) {
          const { compressConversation } = await import('./compress')
          const result = await compressConversation(messages, budget.conversation, this.adapter, this.toolContext.sessionId)
          messages.length = 0
          messages.push(...result.retainedMessages)
          const { buildSnapshot } = await import('./snapshot')
          this.obs.logger?.logSnapshot?.(buildSnapshot({
            sessionId: this.toolContext.sessionId,
            trigger: 'context_compression',
            compressedSummary: result.summary,
            messagesBefore: result.stats.messagesBefore,
            messagesAfter: result.stats.messagesAfter,
          }))
        }
      }

      // Inject queued messages into the last user message (tool result)
      const queued = getQueuedMessages?.() ?? []
      hadQueuedMessages = false
      if (queued.length > 0 && messages.length > 0) {
        const lastIdx = messages.length - 1
        if (messages[lastIdx].role === 'user') {
          messages[lastIdx] = injectQueuedMessages(messages[lastIdx], queued)
          hadQueuedMessages = true
        }
      }

      // Yield to pending message if one arrived during tool execution
      if (shouldInterrupt?.() && !hadQueuedMessages) {
        const finalRequest: CompletionRequest = {
          messages,
          system,
          stream: true,
          maxTokens: context.maxOutput ?? 16384,
        }
        const finalStart = Date.now()
        const finalResponse = await this.completeWithStreamFallback(finalRequest, onTextDelta)
        const finalDurationMs = Date.now() - finalStart
        this.logLLMRequest(finalResponse, userMessage, finalDurationMs)

        const finalContent = this.filterContent(finalResponse.content)
        const finalMsg: Message = {
          id: generateId(),
          sessionId: this.toolContext.sessionId,
          role: 'assistant',
          messageType: 'message',
          content: finalContent,
          model: finalResponse.model,
          createdAt: now(),
        }
        messages.push(finalMsg)
        newMessages.push(finalMsg)
        onNewMessage?.(finalMsg)
        break
      }
    }

    // End root trace span
    if (rootSpan) {
      this.obs.tracer?.endSpan(rootSpan.id, 'success', {
        messageCount: newMessages.length,
      })
    }

    return newMessages
  }

  private async completeWithStreamFallback(
    request: CompletionRequest,
    onTextDelta?: (delta: string, meta: { role: 'assistant'; turnId: string }) => void
  ): Promise<CompletionResponse> {
    try {
      const streamed = await this.completeFromStream(request, onTextDelta)
      if (streamed.content.length === 0) {
        throw new Error('stream returned empty content')
      }
      return streamed
    } catch (streamErr) {
      this.toolContext.logger.warn('llm_stream_fallback_to_complete', {
        sessionId: this.toolContext.sessionId,
        error: streamErr instanceof Error ? streamErr.message : String(streamErr),
      })
      return await this.adapter.complete({ ...request, stream: false })
    }
  }

  private async completeFromStream(
    request: CompletionRequest,
    onTextDelta?: (delta: string, meta: { role: 'assistant'; turnId: string }) => void
  ): Promise<CompletionResponse> {
    const stream = this.adapter.stream({ ...request, stream: true })
    const turnId = generatePrefixedId('turn_')
    const responseId = generatePrefixedId('resp_')

    const textParts: string[] = []
    const toolCalls = new Map<string, { id: string; name: string; args: string }>()

    let currentToolId: string | null = null
    let stopReason: CompletionResponse['stopReason'] = 'end_turn'
    let usage: TokenUsage | undefined
    let model = request.model ?? 'unknown'

    for await (const event of stream) {
      if (event.type === 'text_delta') {
        const data = this.toRecord(event.data)
        const delta = typeof data.text === 'string' ? data.text : ''
        if (!delta) continue
        textParts.push(delta)
        onTextDelta?.(delta, { role: 'assistant', turnId })
        continue
      }

      if (event.type === 'tool_use_start') {
        const data = this.toRecord(event.data)
        const id = typeof data.id === 'string' ? data.id : generatePrefixedId('toolu_')
        const name = typeof data.name === 'string' ? data.name : 'unknown_tool'
        currentToolId = id
        toolCalls.set(id, { id, name, args: '' })
        continue
      }

      if (event.type === 'tool_use_delta') {
        const data = this.toRecord(event.data)
        const chunk = typeof data.arguments === 'string' ? data.arguments : ''
        if (!chunk) continue

        const explicitId = typeof data.id === 'string' ? data.id : null
        const targetId = explicitId ?? currentToolId

        if (!targetId) continue
        if (!toolCalls.has(targetId)) {
          toolCalls.set(targetId, { id: targetId, name: 'unknown_tool', args: '' })
        }
        const existing = toolCalls.get(targetId)
        if (existing) {
          existing.args += chunk
        }
        continue
      }

      if (event.type === 'tool_use_end') {
        const data = this.toRecord(event.data)
        const endedId = typeof data.id === 'string' ? data.id : currentToolId
        if (endedId) currentToolId = endedId === currentToolId ? null : currentToolId
        continue
      }

      if (event.type === 'done') {
        const data = this.toRecord(event.data)
        stopReason = this.mapFinishReason(
          typeof data.finishReason === 'string' ? data.finishReason : undefined
        )
        usage = this.extractUsage(data.usage)
        if (typeof data.model === 'string') {
          model = data.model
        }
        continue
      }

      if (event.type === 'error') {
        const data = this.toRecord(event.data)
        throw new Error(
          typeof data.message === 'string'
            ? data.message
            : 'Unknown streaming error'
        )
      }
    }

    const content: ContentBlock[] = []
    if (textParts.length > 0) {
      content.push({ type: 'text', text: textParts.join('') })
    }

    for (const tc of toolCalls.values()) {
      let input: Record<string, unknown>
      try {
        input = this.safeParseToolInput(tc.args)
      } catch (e) {
        input = { __parse_error: e instanceof Error ? e.message : 'Malformed tool input JSON' }
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input,
      })
    }

    if (!usage) {
      usage = { input: 0, output: 0 }
    }

    if (content.some((b) => b.type === 'tool_use')) {
      stopReason = 'tool_use'
    }

    return {
      id: responseId,
      content,
      stopReason,
      usage,
      model,
    }
  }

  private mapFinishReason(reason?: string): CompletionResponse['stopReason'] {
    if (!reason) return 'end_turn'
    if (reason === 'tool_use' || reason === 'tool_calls') return 'tool_use'
    if (reason === 'max_tokens' || reason === 'length') return 'max_tokens'
    return 'end_turn'
  }

  private safeParseToolInput(raw: string): Record<string, unknown> {
    if (!raw.trim()) return {}
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object'
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      throw new ToolInputParseError(
        `Failed to parse tool input JSON (${raw.length} chars, likely truncated by max_tokens)`
      )
    }
  }

  private extractUsage(value: unknown): TokenUsage | undefined {
    if (!value || typeof value !== 'object') return undefined
    const data = value as Record<string, unknown>
    const input = this.toNumber(data.input) ?? this.toNumber(data.input_tokens)
    const output = this.toNumber(data.output) ?? this.toNumber(data.output_tokens)
    if (input === undefined && output === undefined) return undefined
    return {
      input: input ?? 0,
      output: output ?? 0,
      cacheWrite: this.toNumber(data.cacheWrite) ?? this.toNumber(data.cache_creation_input_tokens),
      cacheRead: this.toNumber(data.cacheRead) ?? this.toNumber(data.cache_read_input_tokens),
      reasoning: this.toNumber(data.reasoning) ?? this.toNumber(data.reasoning_tokens),
    }
  }

  private toNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
      ? value as Record<string, unknown>
      : {}
  }

  /**
   * Log an LLM request to the observability layer.
   */
  private logLLMRequest(
    response: CompletionResponse,
    userPrompt: string,
    durationMs: number
  ): void {
    const cost = computeCost(response.usage, this.obs.pricing)
    const responseText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')

    this.obs.logger?.logRequest({
      id: response.id,
      sessionId: this.toolContext.sessionId,
      model: response.model,
      provider: this.obs.providerName ?? 'unknown',
      userPrompt: userPrompt.slice(0, 500),
      response: responseText.slice(0, 500),
      tokens: {
        input: response.usage.input,
        output: response.usage.output,
        cacheWrite: response.usage.cacheWrite,
        cacheRead: response.usage.cacheRead,
      },
      cost,
    })

    this.obs.metrics?.recordRequest({
      id: response.id,
      sessionId: this.toolContext.sessionId,
      model: response.model,
      provider: this.obs.providerName ?? 'unknown',
      inputTokens: response.usage.input,
      outputTokens: response.usage.output,
      cacheWriteTokens: response.usage.cacheWrite,
      cacheReadTokens: response.usage.cacheRead,
      cost,
      durationMs,
      createdAt: now(),
    })
  }

  /**
   * Filter secrets from content blocks.
   */
  private filterContent(content: ContentBlock[]): ContentBlock[] {
    const filter = this.obs.secretFilter
    if (!filter) return content

    return content.map((block) => {
      if (block.type === 'text') {
        return { ...block, text: filter.filter(block.text) }
      }
      return block
    })
  }
}
