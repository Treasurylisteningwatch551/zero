import type {
  Session as SessionData,
  SessionSource,
  SessionStatus,
  Message,
  ToolDefinition,
  SecretFilter,
} from '@zero-os/shared'
import { generateSessionId, generateId, now, Mutex } from '@zero-os/shared'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import type { ModelRouter } from '@zero-os/model'
import { Agent, type AgentConfig, type AgentContext, type AgentObservability } from '../agent/agent'
import { buildSystemPrompt } from '../agent/prompt'
import { loadSkills } from '../skill/loader'
import { allocateBudget } from '../agent/budget'
import { estimateConversationTokens } from '../agent/context'
import type { QueuedMessage } from '../agent/queue'
import { buildSnapshot } from '../agent/snapshot'
import type { ToolRegistry } from '../tool/registry'
import type { JsonlLogger, MetricsDB, Tracer, SessionDB } from '@zero-os/observe'
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
  secretResolver?: (ref: string) => string | undefined
  memoryRetriever?: MemoryRetriever
  memoryStore?: import('@zero-os/shared').ToolContext['memoryStore']
  identityMemory?: string
  memoContent?: string
  globalIdentity?: string
  agentIdentity?: string
  memoReader?: () => string
  identityReader?: (agentName: string) => { global: string; agent: string }
  bus?: {
    emit(topic: string, data: Record<string, unknown>): void
  }
  sessionDb?: SessionDB
}

/**
 * Options for Session.handleMessage().
 */
export interface HandleMessageOptions {
  /** Called synchronously for every new Message (user, assistant, tool_result). */
  onProgress?: (msg: Message) => void
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
  private lastAgentConfig: AgentConfig | null = null
  private lastSystemPrompt: string = ''

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

    // Persist session metadata to DB
    this.deps.sessionDb?.saveSession(this.data)
  }

  /**
   * Initialize the agent for this session.
   */
  initAgent(config: AgentConfig): void {
    this.lastAgentConfig = config
    const adapter = this.modelRouter.getAdapter()
    const resolved = this.modelRouter.getCurrentModel()

    const projectRoot = process.cwd()
    const workspacePath = join(projectRoot, '.zero', 'workspace', config.name)
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true })
    }

    const observabilityHandle = this.deps.logger && this.deps.metrics
      ? {
          logOperation: this.deps.logger.logOperation.bind(this.deps.logger),
          recordOperation: this.deps.metrics.recordOperation.bind(this.deps.metrics),
        }
      : undefined

    const toolContext = {
      sessionId: this.data.id,
      workDir: workspacePath,
      projectRoot,
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
      secretResolver: this.deps.secretResolver,
      memoryStore: this.deps.memoryStore,
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

    // Persist session with agent config
    this.deps.sessionDb?.saveSession(this.data, JSON.stringify(config))
  }

  /**
   * Handle a user message.
   */
  async handleMessage(content: string, options?: HandleMessageOptions): Promise<Message[]> {
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
      return await this.processMessage(content, options)
    } finally {
      this.mutex.release(lockId)
      // Persist messages and system prompt after processing completes
      this.deps.sessionDb?.saveMessages(this.data.id, this.messages)
      if (this.lastSystemPrompt) {
        const agentConfig = this.lastAgentConfig
        this.deps.sessionDb?.saveSession(
          this.data,
          agentConfig ? JSON.stringify(agentConfig) : undefined,
          this.lastSystemPrompt
        )
      }
    }
  }

  private async processMessage(content: string, options?: HandleMessageOptions): Promise<Message[]> {
    // Retrieve relevant memories
    const currentModel = this.modelRouter.getCurrentModel()
    const tools = this.toolRegistry.getDefinitions()

    let systemPrompt: string
    let retrievedMemories: string[] = []

    // Hot-reload memo content on each call
    const memoContent = this.deps.memoReader?.() ?? this.deps.memoContent ?? ''

    // Hot-reload identity on each call
    const agentName = this.lastAgentConfig?.name ?? 'zero'
    const identity = this.deps.identityReader?.(agentName)
    const globalIdentity = identity?.global ?? this.deps.globalIdentity ?? ''
    const agentIdentity = identity?.agent ?? this.deps.agentIdentity ?? ''

    // Retrieval decision: determine if we need to search memories
    let memories: import('@zero-os/shared').Memory[] = []
    if (this.deps.memoryRetriever) {
      const adapter = this.modelRouter.getAdapter()
      const decisionPrompt = buildRetrievalDecisionPrompt(content, globalIdentity)
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

    const projectRoot = process.cwd()
    const workspacePath = join(projectRoot, '.zero', 'workspace', agentName)

    // Hot-reload skills on each call
    const skills = loadSkills(join(projectRoot, '.zero', 'skills'))

    if (globalIdentity || agentIdentity || memoContent) {
      // Use structured XML prompt builder
      systemPrompt = buildSystemPrompt({
        agentName,
        agentDescription: '擅长 TypeScript 全栈开发，使用 Bun 运行时。',
        tools,
        skills,
        globalIdentity,
        agentIdentity,
        memo: memoContent,
        retrievedMemories: memories,
        currentTime: new Date().toISOString(),
        workspacePath,
        projectRoot,
      })
    } else {
      // Backward compatible: simple prompt
      systemPrompt = 'You are ZeRo OS, an AI agent system running on macOS.'
    }

    this.lastSystemPrompt = systemPrompt

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
      options?.onProgress?.(msg)
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

  /**
   * Restore a session from persisted data (bypasses constructor side-effects).
   */
  static restore(
    data: SessionData,
    messages: Message[],
    modelRouter: ModelRouter,
    toolRegistry: ToolRegistry,
    deps: SessionDeps = {},
    systemPrompt?: string
  ): Session {
    const session = Object.create(Session.prototype) as Session
    ;(session as any).data = data
    ;(session as any).messages = messages
    ;(session as any).modelRouter = modelRouter
    ;(session as any).toolRegistry = toolRegistry
    ;(session as any).deps = deps
    ;(session as any).mutex = new Mutex()
    ;(session as any).interruptFlag = false
    ;(session as any).messageQueue = []
    ;(session as any).agent = null
    ;(session as any).lastAgentConfig = null
    ;(session as any).lastSystemPrompt = systemPrompt ?? ''
    return session
  }

  getAgentConfig(): AgentConfig | null {
    return this.lastAgentConfig
  }

  getSystemPrompt(): string {
    return this.lastSystemPrompt
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
    // Persist status change
    this.deps.sessionDb?.updateStatus(this.data.id, status, this.data.updatedAt)
    // Emit session:end when status transitions to completed
    if (status === 'completed' || status === 'error') {
      this.deps.bus?.emit('session:end', {
        sessionId: this.data.id,
        status,
      })
    }
  }
}
