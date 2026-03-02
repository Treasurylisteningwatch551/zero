import type {
  Session as SessionData,
  SessionSource,
  SessionStatus,
  Message,
  ToolDefinition,
  SecretFilter,
} from '@zero-os/shared'
import { generateSessionId, now } from '@zero-os/shared'
import type { ModelRouter } from '@zero-os/model'
import { Agent, type AgentConfig, type AgentContext, type AgentObservability } from '../agent/agent'
import type { ToolRegistry } from '../tool/registry'
import type { JsonlLogger, MetricsDB, Tracer } from '@zero-os/observe'
import type { MemoryRetriever } from '@zero-os/memory'

/**
 * Dependencies injected into Session for observability, memory, and eventing.
 */
export interface SessionDeps {
  logger?: JsonlLogger
  metrics?: MetricsDB
  tracer?: Tracer
  secretFilter?: SecretFilter
  memoryRetriever?: MemoryRetriever
  identityMemory?: string
  bus?: {
    emit(topic: string, data: Record<string, unknown>): void
  }
}

/**
 * Session — manages the lifecycle of a single conversation.
 */
export class Session {
  readonly data: SessionData
  private messages: Message[] = []
  private modelRouter: ModelRouter
  private toolRegistry: ToolRegistry
  private agent: Agent | null = null
  private deps: SessionDeps

  constructor(
    source: SessionSource,
    modelRouter: ModelRouter,
    toolRegistry: ToolRegistry,
    deps: SessionDeps = {}
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
    this.deps = deps

    // Emit session:create event
    this.deps.bus?.emit('session:create', {
      sessionId: this.data.id,
      source,
      model: this.data.currentModel,
    })
  }

  /**
   * Initialize the agent for this session.
   */
  initAgent(config: AgentConfig): void {
    const adapter = this.modelRouter.getAdapter()
    const resolved = this.modelRouter.getCurrentModel()

    const observabilityHandle = this.deps.logger && this.deps.metrics
      ? {
          logOperation: this.deps.logger.logOperation.bind(this.deps.logger),
          recordOperation: this.deps.metrics.recordOperation.bind(this.deps.metrics),
        }
      : undefined

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
      secretFilter: this.deps.secretFilter,
      observability: observabilityHandle,
    }

    const agentObs: AgentObservability = {
      logger: this.deps.logger,
      metrics: this.deps.metrics,
      tracer: this.deps.tracer,
      secretFilter: this.deps.secretFilter,
      bus: this.deps.bus,
      providerName: resolved?.providerName,
      pricing: resolved?.modelConfig.pricing,
    }

    this.agent = new Agent(config, adapter, this.toolRegistry, toolContext, agentObs)
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

    // Retrieve relevant memories
    let retrievedMemories: string[] = []
    if (this.deps.memoryRetriever) {
      const memories = await this.deps.memoryRetriever.retrieve(content, { topN: 5 })
      retrievedMemories = memories.map(
        (m) => `[${m.type}] ${m.title}\n${m.content}`
      )
    }

    const context: AgentContext = {
      systemPrompt: 'You are ZeRo OS, an AI agent system running on macOS.',
      identityMemory: this.deps.identityMemory,
      retrievedMemories,
      conversationHistory: this.messages,
      tools: this.toolRegistry.getDefinitions(),
    }

    const newMessages = await this.agent.run(context, content)
    this.messages.push(...newMessages)
    this.data.updatedAt = now()

    // Emit session:update
    this.deps.bus?.emit('session:update', {
      sessionId: this.data.id,
      event: 'message_handled',
      messageCount: this.messages.length,
    })

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
        const oldModel = this.data.currentModel
        const result = this.modelRouter.switchModel(args)
        if (result.success && result.model) {
          this.data.currentModel = result.model.modelName
          this.data.modelHistory[this.data.modelHistory.length - 1].to = now()
          this.data.modelHistory.push({ model: result.model.modelName, from: now(), to: null })
          // Emit model:switch event
          this.deps.bus?.emit('model:switch', {
            sessionId: this.data.id,
            from: oldModel,
            to: result.model.modelName,
          })
        }
        return [this.makeSystemMessage(result.message)]
      }
      case '/new': {
        // Reset conversation, optionally switch model
        this.messages = []
        if (args) {
          const result = this.modelRouter.switchModel(args)
          if (result.success && result.model) {
            this.data.currentModel = result.model.modelName
            this.data.modelHistory[this.data.modelHistory.length - 1].to = now()
            this.data.modelHistory.push({ model: result.model.modelName, from: now(), to: null })
          }
          // Re-initialize agent with current model
          if (this.agent) {
            this.initAgent({ name: 'zero', systemPrompt: 'You are ZeRo OS, an AI agent system running on macOS.' })
          }
          return [this.makeSystemMessage(`New conversation started with model: ${this.data.currentModel}`)]
        }
        // Re-initialize agent
        if (this.agent) {
          this.initAgent({ name: 'zero', systemPrompt: 'You are ZeRo OS, an AI agent system running on macOS.' })
        }
        return [this.makeSystemMessage('New conversation started.')]
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
    // Emit session:end when status transitions to completed
    if (status === 'completed' || status === 'error') {
      this.deps.bus?.emit('session:end', {
        sessionId: this.data.id,
        status,
      })
    }
  }
}
