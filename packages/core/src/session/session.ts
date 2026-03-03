import type {
  Session as SessionData,
  SessionSource,
  SessionStatus,
  Message,
  ToolDefinition,
  SecretFilter,
} from '@zero-os/shared'
import { generateSessionId, generateId, now, Mutex } from '@zero-os/shared'
import type { ModelRouter } from '@zero-os/model'
import { Agent, type AgentConfig, type AgentContext, type AgentObservability } from '../agent/agent'
import { buildSystemPrompt } from '../agent/prompt'
import { allocateBudget } from '../agent/budget'
import { estimateConversationTokens } from '../agent/context'
import type { QueuedMessage } from '../agent/queue'
import { buildSnapshot } from '../agent/snapshot'
import type { ToolRegistry } from '../tool/registry'
import type { JsonlLogger, MetricsDB, Tracer } from '@zero-os/observe'
import type { MemoryRetriever } from '@zero-os/memory'
import { buildRetrievalDecisionPrompt, parseRetrievalDecision } from '@zero-os/memory'

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
  memoContent?: string
  globalIdentity?: string
  agentIdentity?: string
  memoReader?: () => string
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
  private mutex = new Mutex()
  private interruptFlag = false
  private messageQueue: QueuedMessage[] = []

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

    // Log session start snapshot
    this.deps.logger?.logSnapshot?.(buildSnapshot({
      sessionId: this.data.id,
      trigger: 'session_start',
      tools: this.toolRegistry.getDefinitions().map(t => t.name),
    }))
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
      return await this.handleCommand(content)
    }

    if (!this.agent) {
      throw new Error('Agent not initialized. Call initAgent() first.')
    }

    // If another message is already processing, queue it instead of blocking
    if (this.mutex.isLocked()) {
      this.messageQueue.push({ content, timestamp: now() })
      this.interruptFlag = true
      return []
    }

    const lockId = generateId()
    await this.mutex.acquire(lockId)
    this.interruptFlag = false

    try {
      return await this.processMessage(content)
    } finally {
      this.mutex.release(lockId)
    }
  }

  private async processMessage(content: string): Promise<Message[]> {
    // Retrieve relevant memories
    const currentModel = this.modelRouter.getCurrentModel()
    const tools = this.toolRegistry.getDefinitions()

    let systemPrompt: string
    let retrievedMemories: string[] = []

    // Hot-reload memo content on each call
    const memoContent = this.deps.memoReader?.() ?? this.deps.memoContent ?? ''

    // Retrieval decision: determine if we need to search memories
    let memories: import('@zero-os/shared').Memory[] = []
    if (this.deps.memoryRetriever) {
      const adapter = this.modelRouter.getAdapter()
      const decisionPrompt = buildRetrievalDecisionPrompt(content, this.deps.globalIdentity ?? '')
      try {
        const decisionResp = await adapter.complete({
          messages: [{ id: generateId(), sessionId: this.data.id, role: 'user', messageType: 'message',
            content: [{ type: 'text', text: decisionPrompt }], createdAt: now() }],
          system: '你是一个检索决策助手。分析用户消息判断是否需要检索记忆库。返回 JSON。',
          stream: false, maxTokens: 256,
        })
        const decisionText = decisionResp.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('')
        const decision = parseRetrievalDecision(decisionText)

        if (decision.need && decision.queries) {
          for (const query of decision.queries) {
            const results = await this.deps.memoryRetriever.retrieve(query, { topN: 3 })
            memories.push(...results)
          }
          // Deduplicate by ID
          const seen = new Set<string>()
          memories = memories.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true })
          memories = memories.slice(0, 5)
        }
      } catch {
        // Fallback: direct retrieval if decision call fails
        memories = await this.deps.memoryRetriever.retrieve(content, { topN: 5 })
      }
      retrievedMemories = memories.map(
        (m) => `[${m.type}] ${m.title}\n${m.content}`
      )
    }

    if (this.deps.globalIdentity || this.deps.agentIdentity || memoContent) {
      // Use structured XML prompt builder
      systemPrompt = buildSystemPrompt({
        agentName: 'zero',
        agentDescription: '擅长 TypeScript 全栈开发，使用 Bun 运行时。',
        tools,
        globalIdentity: this.deps.globalIdentity ?? '',
        agentIdentity: this.deps.agentIdentity ?? '',
        memo: memoContent,
        retrievedMemories: memories,
        currentTime: new Date().toISOString(),
      })
    } else {
      // Backward compatible: simple prompt
      systemPrompt = 'You are ZeRo OS, an AI agent system running on macOS.'
    }

    const context: AgentContext = {
      systemPrompt,
      identityMemory: this.deps.identityMemory,
      retrievedMemories,
      conversationHistory: this.messages,
      tools,
      maxContext: currentModel?.modelConfig.maxContext,
      maxOutput: currentModel?.modelConfig.maxOutput,
    }

    // Push messages to session in real-time so getMessages() reflects in-progress state
    const onNewMessage = (msg: Message) => {
      this.messages.push(msg)
      this.data.updatedAt = now()
    }

    const shouldInterrupt = () => this.interruptFlag
    const getQueuedMessages = () => {
      const msgs = [...this.messageQueue]
      this.messageQueue.length = 0
      return msgs
    }
    const newMessages = await this.agent!.run(context, content, onNewMessage, shouldInterrupt, getQueuedMessages)

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
  private async handleCommand(command: string): Promise<Message[]> {
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

          // Log model switch snapshot
          this.deps.logger?.logSnapshot?.(buildSnapshot({
            sessionId: this.data.id,
            trigger: 'model_switch',
            tools: this.toolRegistry.getDefinitions().map(t => t.name),
          }))

          // Context migration: check if conversation exceeds new model's budget
          if (this.messages.length > 0 && result.model.modelConfig) {
            const newBudget = allocateBudget(
              result.model.modelConfig.maxContext,
              result.model.modelConfig.maxOutput,
            )
            const currentTokens = estimateConversationTokens(this.messages)
            if (currentTokens > newBudget.conversation) {
              const adapter = this.modelRouter.getAdapter()
              const { compressConversation } = await import('../agent/compress')
              const compResult = await compressConversation(
                this.messages, newBudget.conversation, adapter, this.data.id,
              )
              this.messages.length = 0
              this.messages.push(...compResult.retainedMessages)
            }
          }

          // Re-initialize agent with new adapter
          if (this.agent) {
            this.initAgent({ name: 'zero', systemPrompt: 'You are ZeRo OS, an AI agent system running on macOS.' })
          }
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
