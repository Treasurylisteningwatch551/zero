import type {
  Session as SessionData,
  SessionSource,
  SessionStatus,
  Message,
  ToolDefinition,
} from '@zero-os/shared'
import { generateSessionId, now } from '@zero-os/shared'
import type { ModelRouter } from '@zero-os/model'
import { Agent, type AgentConfig, type AgentContext } from '../agent/agent'
import type { ToolRegistry } from '../tool/registry'

/**
 * Session — manages the lifecycle of a single conversation.
 */
export class Session {
  readonly data: SessionData
  private messages: Message[] = []
  private modelRouter: ModelRouter
  private toolRegistry: ToolRegistry
  private agent: Agent | null = null

  constructor(
    source: SessionSource,
    modelRouter: ModelRouter,
    toolRegistry: ToolRegistry
  ) {
    const currentModel = modelRouter.getCurrentModel()
    this.data = {
      id: generateSessionId(),
      createdAt: now(),
      updatedAt: now(),
      source,
      status: 'active',
      currentModel: currentModel?.modelName ?? 'unknown',
      modelHistory: [
        {
          model: currentModel?.modelName ?? 'unknown',
          from: now(),
          to: null,
        },
      ],
      tags: [],
    }
    this.modelRouter = modelRouter
    this.toolRegistry = toolRegistry
  }

  /**
   * Initialize the agent for this session.
   */
  initAgent(config: AgentConfig): void {
    const adapter = this.modelRouter.getAdapter()
    const toolContext = {
      sessionId: this.data.id,
      workDir: process.cwd(),
      logger: {
        info: (event: string, data?: Record<string, unknown>) =>
          console.log(`[${this.data.id}] ${event}`, data ?? ''),
        warn: (event: string, data?: Record<string, unknown>) =>
          console.warn(`[${this.data.id}] ${event}`, data ?? ''),
        error: (event: string, data?: Record<string, unknown>) =>
          console.error(`[${this.data.id}] ${event}`, data ?? ''),
      },
    }

    this.agent = new Agent(config, adapter, this.toolRegistry, toolContext)
  }

  /**
   * Handle a user message.
   */
  async handleMessage(content: string): Promise<Message[]> {
    // Check for commands
    if (content.startsWith('/')) {
      return this.handleCommand(content)
    }

    if (!this.agent) {
      throw new Error('Agent not initialized. Call initAgent() first.')
    }

    const context: AgentContext = {
      systemPrompt: 'You are ZeRo OS, an AI agent system running on macOS.',
      conversationHistory: this.messages,
      tools: this.toolRegistry.getDefinitions(),
    }

    const newMessages = await this.agent.run(context, content)
    this.messages.push(...newMessages)
    this.data.updatedAt = now()

    return newMessages
  }

  /**
   * Handle session commands (/new, /model, etc.).
   */
  private handleCommand(command: string): Message[] {
    const parts = command.trim().split(/\s+/)
    const cmd = parts[0].toLowerCase()
    const args = parts.slice(1).join(' ')

    switch (cmd) {
      case '/model': {
        if (!args) {
          const current = this.modelRouter.getCurrentModel()
          return [this.makeSystemMessage(`Current model: ${current?.modelName ?? 'none'}`)]
        }
        const result = this.modelRouter.switchModel(args)
        if (result.success && result.model) {
          this.data.currentModel = result.model.modelName
          this.data.modelHistory[this.data.modelHistory.length - 1].to = now()
          this.data.modelHistory.push({ model: result.model.modelName, from: now(), to: null })
        }
        return [this.makeSystemMessage(result.message)]
      }
      default:
        return [this.makeSystemMessage(`Unknown command: ${cmd}`)]
    }
  }

  private makeSystemMessage(text: string): Message {
    return {
      id: Bun.randomUUIDv7(),
      sessionId: this.data.id,
      role: 'assistant',
      messageType: 'notification',
      content: [{ type: 'text', text }],
      createdAt: now(),
    }
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getStatus(): SessionStatus {
    return this.data.status
  }

  setStatus(status: SessionStatus): void {
    this.data.status = status
    this.data.updatedAt = now()
  }
}
