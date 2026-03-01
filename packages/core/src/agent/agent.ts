import type {
  Message,
  ContentBlock,
  CompletionRequest,
  CompletionResponse,
  ToolContext,
  ToolDefinition,
} from '@zero-os/shared'
import { generateId, generatePrefixedId, now } from '@zero-os/shared'
import type { ProviderAdapter } from '@zero-os/model'
import type { BaseTool } from '../tool/base'
import type { ToolRegistry } from '../tool/registry'

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
 * Agent execution engine — runs the tool use loop.
 */
export class Agent {
  private config: AgentConfig
  private adapter: ProviderAdapter
  private toolRegistry: ToolRegistry
  private toolContext: ToolContext

  constructor(
    config: AgentConfig,
    adapter: ProviderAdapter,
    toolRegistry: ToolRegistry,
    toolContext: ToolContext
  ) {
    this.config = config
    this.adapter = adapter
    this.toolRegistry = toolRegistry
    this.toolContext = toolContext
  }

  /**
   * Run the agent's tool-use loop until completion or max loops reached.
   */
  async run(context: AgentContext, userMessage: string): Promise<Message[]> {
    const maxLoops = this.config.maxToolLoops ?? 10
    const messages: Message[] = [...context.conversationHistory]
    const newMessages: Message[] = []

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

      const response = await this.adapter.complete(request)

      // Create assistant message
      const assistantMsg: Message = {
        id: generateId(),
        sessionId: this.toolContext.sessionId,
        role: 'assistant',
        messageType: 'message',
        content: response.content,
        model: response.model,
        createdAt: now(),
      }
      messages.push(assistantMsg)
      newMessages.push(assistantMsg)

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

        if (!tool) {
          toolResultBlocks.push({
            type: 'tool_result',
            toolUseId: block.id,
            content: `Unknown tool: ${block.name}`,
            isError: true,
          })
          continue
        }

        const result = await tool.run(this.toolContext, block.input)
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

    return newMessages
  }
}
