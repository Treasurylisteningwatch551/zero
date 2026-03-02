import type {
  Message,
  ContentBlock,
  CompletionRequest,
  CompletionResponse,
  ToolContext,
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

export interface AgentConfig {
  name: string
  systemPrompt: string
  identityMemory?: string
  maxToolLoops?: number
}

export interface AgentContext {
  systemPrompt: string
  identityMemory?: string
  retrievedMemories?: string[]
  conversationHistory: Message[]
  tools: ToolDefinition[]
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
  async run(context: AgentContext, userMessage: string): Promise<Message[]> {
    const maxLoops = this.config.maxToolLoops ?? 10
    const messages: Message[] = [...context.conversationHistory]
    const newMessages: Message[] = []

    // Start root trace span
    const rootSpan = this.obs.tracer?.startSpan(
      this.toolContext.sessionId,
      `agent.run:${this.config.name}`
    )

    // Add user message
    const userMsg: Message = {
      id: generateId(),
      sessionId: this.toolContext.sessionId,
      role: 'user',
      messageType: 'message',
      content: [{ type: 'text', text: userMessage }],
      createdAt: now(),
    }
    messages.push(userMsg)
    newMessages.push(userMsg)

    // Build system prompt
    const systemParts: string[] = [context.systemPrompt]
    if (context.identityMemory) systemParts.push(context.identityMemory)
    if (context.retrievedMemories?.length) {
      systemParts.push('## Relevant Memories\n' + context.retrievedMemories.join('\n---\n'))
    }
    const system = systemParts.join('\n\n')

    for (let loop = 0; loop < maxLoops; loop++) {
      const request: CompletionRequest = {
        messages,
        tools: context.tools,
        system,
        stream: false,
        maxTokens: 4096,
      }

      const llmStart = Date.now()
      const response = await this.adapter.complete(request)
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

      // Emit session update event
      this.obs.bus?.emit('session:update', {
        sessionId: this.toolContext.sessionId,
        event: 'assistant_response',
        model: response.model,
      })

      // If no tool use, we're done
      if (response.stopReason !== 'tool_use') {
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

        const result = await tool.run(this.toolContext, block.input)

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

        toolResultBlocks.push({
          type: 'tool_result',
          toolUseId: block.id,
          content: result.output,
          isError: !result.success,
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
