import { existsSync, mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { MemoryRetriever } from '@zero-os/memory'
import type { ModelRouter, ModelSwitchResult, ResolvedModel } from '@zero-os/model'
import type {
  JsonlLogger,
  MetricsDB,
  RequestLogEntry,
  SessionDB,
  SnapshotEntry,
  Tracer,
} from '@zero-os/observe'
import type {
  CompressionResult,
  Message,
  SecretFilter,
  Session as SessionData,
  SessionSource,
  SessionStatus,
  ToolDefinition,
} from '@zero-os/shared'
import { Mutex, generateId, generateSessionId, now } from '@zero-os/shared'
import { Agent, type AgentConfig, type AgentContext, type AgentObservability } from '../agent/agent'
import { allocateBudget } from '../agent/budget'
import { estimateConversationTokens } from '../agent/context'
import { buildDynamicContext, buildSystemPrompt } from '../agent/prompt'
import { CONTINUATION_PROMPT, type QueuedMessage } from '../agent/queue'
import { buildSnapshot } from '../agent/snapshot'
import { TASK_CLOSURE_PROMPT } from '../agent/task-closure'
import { loadBootstrapFiles } from '../bootstrap/loader'
import { loadSkills } from '../skill/loader'
import type { ToolRegistry } from '../tool/registry'

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
  globalIdentity?: string
  agentIdentity?: string
  identityReader?: (agentName: string) => { global: string; agent: string }
  bus?: {
    emit(topic: string, data: Record<string, unknown>): void
  }
  persistModelPreference?: (model: string) => void
  sessionDb?: SessionDB
  schedulerHandle?: import('@zero-os/shared').ToolContext['schedulerHandle']
  scheduleStore?: import('@zero-os/shared').ToolContext['scheduleStore']
}

/**
 * Options for Session.handleMessage().
 */
export interface HandleMessageOptions {
  /** Called synchronously for every new Message (user, assistant, tool_result). */
  onProgress?: (msg: Message) => void
  /** Called for every assistant text delta when the model supports streaming. */
  onTextDelta?: (delta: string, meta: { role: 'assistant'; turnId: string }) => void
  /** Image attachments (base64) to send alongside the text message. */
  images?: Array<{ mediaType: string; data: string }>
}

interface SnapshotContext {
  model: string
  systemPrompt: string
  tools: string[]
  identityMemory?: string
}

const EMPTY_RESPONSE_RETRY_PROMPT =
  'Your previous reply was empty. Continue the current task and provide the actual answer or the next required tool call. Do not return an empty response.'

/**
 * Session — manages the lifecycle of a single conversation.
 */
export class Session {
  readonly data: SessionData
  private messages: Message[] = []
  private modelRouter: ModelRouter
  private toolRegistry: ToolRegistry
  private agent: Agent | null = null
  private activeModel: ResolvedModel | undefined
  private deps: SessionDeps
  private mutex = new Mutex()
  private interruptFlag = false
  private messageQueue: QueuedMessage[] = []
  private lastAgentConfig: AgentConfig | null = null
  private lastSystemPrompt = ''
  private cachedSystemPrompt: string | null = null
  private cachedToolNames: string[] = []
  private knownSkillNames = new Set<string>()
  private currentSnapshotId?: string
  private lastSnapshotContext: SnapshotContext | null = null
  private nextTurnIndex = 1

  constructor(
    source: SessionSource,
    modelRouter: ModelRouter,
    toolRegistry: ToolRegistry,
    deps: SessionDeps = {},
    initialModel?: string,
    sessionId?: string,
  ) {
    const currentModel = initialModel
      ? (modelRouter.resolveModel(initialModel) ??
        modelRouter.getDefaultModel() ??
        modelRouter.getCurrentModel())
      : (modelRouter.getDefaultModel() ?? modelRouter.getCurrentModel())
    const id = sessionId ?? Session.allocateSessionId(source, deps.sessionDb)
    this.data = {
      id,
      createdAt: now(),
      updatedAt: now(),
      source,
      status: 'active',
      currentModel: currentModel ? modelRouter.getModelLabel(currentModel) : 'unknown',
      modelHistory: [
        {
          model: currentModel ? modelRouter.getModelLabel(currentModel) : 'unknown',
          from: now(),
          to: null,
        },
      ],
      tags: [],
    }
    this.modelRouter = modelRouter
    this.toolRegistry = toolRegistry
    this.activeModel = currentModel
    this.deps = deps

    // Emit session:create event
    this.deps.bus?.emit('session:create', {
      sessionId: this.data.id,
      source,
      model: this.data.currentModel,
    })

    // Persist session metadata to DB
    this.deps.sessionDb?.saveSession(this.data)
    this.deps.logger?.syncSessionActiveState(this.data.id, this.data.status)
  }

  /**
   * Initialize the agent for this session.
   */
  initAgent(config: AgentConfig): void {
    this.lastAgentConfig = config
    this.cachedSystemPrompt = null
    this.cachedToolNames = []
    this.lastSystemPrompt = ''
    this.knownSkillNames.clear()
    const resolved =
      this.activeModel ?? this.modelRouter.getDefaultModel() ?? this.modelRouter.getCurrentModel()
    if (!resolved) {
      throw new Error('No active model available for session.')
    }
    const adapter = resolved.adapter

    const projectRoot = process.cwd()
    const workspacePath = join(projectRoot, '.zero', 'workspace', config.name)
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true })
    }

    const observabilityHandle =
      this.deps.logger && this.deps.metrics
        ? {
            logEvent: this.deps.logger.logEvent.bind(this.deps.logger),
            recordOperation: this.deps.metrics.recordOperation.bind(this.deps.metrics),
          }
        : undefined

    const toolContext = {
      sessionId: this.data.id,
      currentModel: this.modelRouter.getModelLabel(resolved),
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
      requestLogger: this.deps.logger,
      tracer: this.deps.tracer,
      secretFilter: this.deps.secretFilter,
      observability: observabilityHandle,
      secretResolver: this.deps.secretResolver,
      memoryRetriever: this.deps.memoryRetriever,
      memoryStore: this.deps.memoryStore,
      channelBinding: this.data.channelId
        ? {
            source: this.data.source,
            channelName: this.data.channelName ?? this.data.source,
            channelId: this.data.channelId,
          }
        : undefined,
      schedulerHandle: this.deps.schedulerHandle,
      scheduleStore: this.deps.scheduleStore,
    }

    const agentObs: AgentObservability = {
      logger: this.deps.logger,
      metrics: this.deps.metrics,
      tracer: this.deps.tracer,
      secretFilter: this.deps.secretFilter,
      bus: this.deps.bus,
      providerName: resolved?.providerName,
      modelLabel: this.modelRouter.getModelLabel(resolved),
      pricing: resolved?.modelConfig.pricing,
      getCurrentSnapshotId: () => this.currentSnapshotId,
      onContextCompressed: (event) => {
        this.logCompressionSnapshot(event.summary, event.stats)
      },
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
      const replies = await this.handleCommand(content)
      this.persistState()
      return replies
    }

    if (!this.agent) {
      throw new Error('Agent not initialized. Call initAgent() first.')
    }

    // If another message is already processing, queue it instead of blocking
    if (this.mutex.isLocked()) {
      this.messageQueue.push({ content, images: options?.images, timestamp: now() })
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
      this.persistState()
    }
  }

  private static sameStringArray(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  private static snapshotContextFromEntry(entry?: SnapshotEntry): SnapshotContext | null {
    if (!entry?.model || !entry.systemPrompt) {
      return null
    }

    return {
      model: entry.model,
      systemPrompt: entry.systemPrompt,
      tools: entry.tools ?? [],
      identityMemory: entry.identityMemory,
    }
  }

  private getCurrentModelLabel(): string | undefined {
    const resolved =
      this.activeModel ?? this.modelRouter.getDefaultModel() ?? this.modelRouter.getCurrentModel()
    return resolved ? this.modelRouter.getModelLabel(resolved) : undefined
  }

  private getAgentName(): string {
    return this.lastAgentConfig?.name ?? 'zero'
  }

  private getToolNames(tools: ToolDefinition[]): string[] {
    return tools.map((tool) => tool.name)
  }

  private ensureStaticContext(): {
    currentModel: ResolvedModel | undefined
    tools: ToolDefinition[]
    toolNames: string[]
    systemPrompt: string
    projectRoot: string
    workspacePath: string
  } {
    const currentModel = this.activeModel
    const tools = this.toolRegistry.getDefinitions()
    const toolNames = this.getToolNames(tools)
    const agentName = this.getAgentName()
    const projectRoot = process.cwd()
    const workspacePath = join(projectRoot, '.zero', 'workspace', agentName)

    if (!this.cachedSystemPrompt || !Session.sameStringArray(toolNames, this.cachedToolNames)) {
      const identity = this.deps.identityReader?.(agentName)
      const globalIdentity = identity?.global ?? this.deps.globalIdentity ?? ''
      const agentIdentity = identity?.agent ?? this.deps.agentIdentity ?? ''
      const promptMode = this.lastAgentConfig?.promptMode ?? 'full'

      const globalSkills = loadSkills(join(projectRoot, '.zero', 'skills'))
      const workspaceSkills = loadSkills(join(workspacePath, 'skills'))
      const skills = [...globalSkills, ...workspaceSkills]
      const bootstrapFiles = loadBootstrapFiles(workspacePath, promptMode)

      const runtimeInfo = {
        agentId: agentName,
        host: hostname(),
        os: `${process.platform} (${process.arch})`,
        model: currentModel ? this.modelRouter.getModelLabel(currentModel) : undefined,
        shell: process.env.SHELL ?? 'zsh',
        projectRoot,
      }

      this.cachedSystemPrompt = buildSystemPrompt({
        agentName,
        agentDescription:
          this.lastAgentConfig?.agentInstruction || '擅长 TypeScript 全栈开发，使用 Bun 运行时。',
        tools,
        skills,
        globalIdentity,
        agentIdentity,
        workspacePath,
        projectRoot,
        promptMode,
        bootstrapFiles,
        runtimeInfo,
      })
      this.cachedToolNames = [...toolNames]

      for (const skill of skills) this.knownSkillNames.add(skill.name)
    }

    const systemPrompt = this.cachedSystemPrompt
    this.lastSystemPrompt = systemPrompt

    return {
      currentModel,
      tools,
      toolNames,
      systemPrompt,
      projectRoot,
      workspacePath,
    }
  }

  private getCurrentSnapshotContext(toolNames = this.cachedToolNames): SnapshotContext | null {
    const model = this.getCurrentModelLabel()
    if (!model || !this.lastSystemPrompt) {
      return null
    }

    return {
      model,
      systemPrompt: this.lastSystemPrompt,
      tools: [...toolNames],
      identityMemory: this.deps.identityMemory,
    }
  }

  private writeSnapshot(
    trigger: string,
    context: SnapshotContext,
    extra: Partial<Omit<SnapshotEntry, 'id' | 'sessionId' | 'trigger' | 'ts'>> = {},
  ): string | undefined {
    if (!this.deps.logger) return undefined

    const snapshot = buildSnapshot({
      sessionId: this.data.id,
      trigger,
      model: context.model,
      systemPrompt: context.systemPrompt,
      tools: [...context.tools],
      identityMemory: context.identityMemory,
      parentSnapshot: extra.parentSnapshot ?? this.currentSnapshotId,
      compressedSummary: extra.compressedSummary,
      messagesBefore: extra.messagesBefore,
      messagesAfter: extra.messagesAfter,
      compressedRange: extra.compressedRange,
    })

    this.deps.logger.logSnapshot(snapshot)
    const snapshotSpan = this.deps.tracer?.startSpan(
      this.data.id,
      `snapshot:${trigger}`,
      undefined,
      {
        kind: 'snapshot',
        agentName: this.getAgentName(),
        data: {
          snapshotId: snapshot.id,
          trigger,
          model: snapshot.model,
        },
      },
    )
    if (snapshotSpan) {
      this.deps.tracer?.updateSpan(snapshotSpan.id, {
        data: {
          parentSnapshot: snapshot.parentSnapshot,
          tools: snapshot.tools,
          messagesBefore: snapshot.messagesBefore,
          messagesAfter: snapshot.messagesAfter,
        },
      })
      this.deps.tracer?.endSpan(snapshotSpan.id, 'success')
    }
    this.currentSnapshotId = snapshot.id
    this.lastSnapshotContext = {
      model: context.model,
      systemPrompt: context.systemPrompt,
      tools: [...context.tools],
      identityMemory: context.identityMemory,
    }
    return snapshot.id
  }

  private ensureCurrentContextSnapshot(toolNames: string[]): void {
    const context = this.getCurrentSnapshotContext(toolNames)
    if (!context) return

    if (!this.currentSnapshotId || !this.lastSnapshotContext) {
      this.writeSnapshot('session_start', context)
      return
    }

    if (
      this.lastSnapshotContext.model === context.model &&
      this.lastSnapshotContext.systemPrompt === context.systemPrompt &&
      this.lastSnapshotContext.identityMemory === context.identityMemory &&
      Session.sameStringArray(this.lastSnapshotContext.tools, context.tools)
    ) {
      return
    }

    const trigger = Session.sameStringArray(this.lastSnapshotContext.tools, context.tools)
      ? 'context_updated'
      : 'tools_changed'
    this.writeSnapshot(trigger, context)
  }

  private logCompressionSnapshot(summary: string, stats: CompressionResult['stats']): void {
    const context = this.getCurrentSnapshotContext()
    if (!context) return

    this.writeSnapshot('context_compression', context, {
      compressedSummary: summary,
      messagesBefore: stats.messagesBefore,
      messagesAfter: stats.messagesAfter,
      compressedRange: stats.compressedRange,
    })
  }

  private restoreSnapshotStateFromLogger(): void {
    const lastSnapshot = this.deps.logger?.readSessionSnapshots(this.data.id).at(-1)
    if (!lastSnapshot) return

    this.currentSnapshotId = lastSnapshot.id
    this.lastSnapshotContext = Session.snapshotContextFromEntry(lastSnapshot)
  }

  private async processMessage(
    content: string,
    options?: HandleMessageOptions,
  ): Promise<Message[]> {
    const { currentModel, tools, toolNames, systemPrompt, projectRoot, workspacePath } =
      this.ensureStaticContext()
    this.ensureCurrentContextSnapshot(toolNames)

    // === DYNAMIC: Per-message context ===

    // Detect newly added skills (incremental notification)
    const globalSkills = loadSkills(join(projectRoot, '.zero', 'skills'))
    const workspaceSkills = loadSkills(join(workspacePath, 'skills'))
    const allSkills = [...globalSkills, ...workspaceSkills]
    const newSkills = allSkills.filter((s) => !this.knownSkillNames.has(s.name))
    for (const s of newSkills) this.knownSkillNames.add(s.name)

    // Build dynamic context — injected into API request only, not stored in messages
    const dynamicCtx = buildDynamicContext({
      newSkills: newSkills.length > 0 ? newSkills : undefined,
    })

    const context: AgentContext = {
      systemPrompt,
      identityMemory: this.deps.identityMemory,
      dynamicContext: dynamicCtx,
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
    const agent = this.agent
    if (!agent) {
      throw new Error('Agent not initialized. Call initAgent() first.')
    }

    const newMessages = await agent.run(
      context,
      content,
      options?.images,
      onNewMessage,
      options?.onTextDelta,
      shouldInterrupt,
      getQueuedMessages,
      { turnIndex: this.allocateTurnIndex() },
    )

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
  async switchModel(target: string): Promise<ModelSwitchResult> {
    const oldModel = this.data.currentModel
    const result = this.modelRouter.selectModel(target)
    if (!result.success || !result.model) {
      return result
    }

    const nextModelLabel = this.modelRouter.getModelLabel(result.model)
    this.activeModel = result.model
    this.data.currentModel = nextModelLabel
    if (this.data.modelHistory.length > 0) {
      this.data.modelHistory[this.data.modelHistory.length - 1].to = now()
    }
    this.data.modelHistory.push({ model: nextModelLabel, from: now(), to: null })
    this.data.updatedAt = now()
    this.deps.persistModelPreference?.(nextModelLabel)

    this.deps.bus?.emit('model:switch', {
      sessionId: this.data.id,
      from: oldModel,
      to: nextModelLabel,
    })

    this.reinitializeAgent()
    if (this.lastAgentConfig) {
      const { toolNames } = this.ensureStaticContext()
      const context = this.getCurrentSnapshotContext(toolNames)
      if (context) {
        this.writeSnapshot('model_switch', context)
      }
    }

    if (this.messages.length > 0) {
      const newBudget = allocateBudget(
        result.model.modelConfig.maxContext,
        result.model.modelConfig.maxOutput,
      )
      const currentTokens = estimateConversationTokens(this.messages)
      if (currentTokens > newBudget.conversation) {
        const { compressConversation } = await import('../agent/compress')
        const compResult = await compressConversation(
          this.messages,
          newBudget.conversation,
          result.model.adapter,
          this.data.id,
        )
        this.messages.length = 0
        this.messages.push(...compResult.retainedMessages)
        this.logCompressionSnapshot(compResult.summary, compResult.stats)
      }
    }

    this.persistState()
    return result
  }

  private async handleCommand(command: string): Promise<Message[]> {
    const parts = command.trim().split(/\s+/)
    const cmd = parts[0].toLowerCase()
    const args = parts.slice(1).join(' ')

    switch (cmd) {
      case '/model': {
        if (!args) {
          return [this.makeSystemMessage(`Current model: ${this.data.currentModel}`)]
        }
        if (args.toLowerCase() === 'list') {
          const available = this.modelRouter
            .getRegistry()
            .listModels()
            .map((model) => `- ${model.providerName}/${model.modelName}`)
            .join('\n')
          return [this.makeSystemMessage(`Available models:\n${available}`)]
        }
        const result = await this.switchModel(args)
        return [this.makeSystemMessage(result.message)]
      }
      case '/new': {
        // Reset conversation, optionally switch model
        this.messages = []
        if (args) {
          const result = await this.switchModel(args)
          if (!result.success) {
            return [this.makeSystemMessage(result.message)]
          }
          return [
            this.makeSystemMessage(
              `New conversation started with model: ${this.data.currentModel}`,
            ),
          ]
        }
        this.reinitializeAgent()
        return [this.makeSystemMessage('New conversation started.')]
      }
      default:
        return [this.makeSystemMessage(`Unknown command: ${cmd}`)]
    }
  }

  private reinitializeAgent(): void {
    if (!this.agent || !this.lastAgentConfig) return
    this.initAgent(this.lastAgentConfig)
  }

  private persistState(): void {
    this.deps.sessionDb?.saveMessages(this.data.id, this.messages)
    const agentConfig = this.lastAgentConfig
    this.deps.sessionDb?.saveSession(
      this.data,
      agentConfig ? JSON.stringify(agentConfig) : undefined,
      this.lastSystemPrompt || undefined,
    )
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

  private static allocateSessionId(source: SessionSource, sessionDb?: SessionDB): string {
    for (let attempt = 0; attempt < 16; attempt++) {
      const id = generateSessionId(source)
      if (!sessionDb?.getSession(id)) {
        return id
      }
    }

    throw new Error(
      `Unable to allocate unique session ID for source "${source}" after 16 attempts.`,
    )
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
    systemPrompt?: string,
  ): Session {
    const normalizedCurrentModel =
      modelRouter.normalizeModelReference(data.currentModel) ?? data.currentModel
    const normalizedHistory = data.modelHistory.map((entry) => ({
      ...entry,
      model: modelRouter.normalizeModelReference(entry.model) ?? entry.model,
    }))
    const activeModel = modelRouter.resolveModel(normalizedCurrentModel)

    const session = Object.create(Session.prototype) as Session
    Object.assign(session, {
      data: {
        ...data,
        currentModel: normalizedCurrentModel,
        modelHistory: normalizedHistory,
      },
      messages,
      modelRouter,
      toolRegistry,
      activeModel,
      deps,
      mutex: new Mutex(),
      interruptFlag: false,
      messageQueue: [],
      agent: null,
      lastAgentConfig: null,
      lastSystemPrompt: systemPrompt ?? '',
      cachedSystemPrompt: null,
      cachedToolNames: [],
      knownSkillNames: new Set<string>(),
      currentSnapshotId: undefined,
      lastSnapshotContext: null,
      nextTurnIndex: Session.deriveNextTurnIndex(data.id, messages, deps.logger),
    })
    session.restoreSnapshotStateFromLogger()
    session.deps.logger?.syncSessionActiveState(session.data.id, session.data.status)
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
    this.deps.logger?.syncSessionActiveState(this.data.id, status)
    // Emit session:end when status transitions to completed
    if (status === 'completed' || status === 'failed') {
      this.deps.bus?.emit('session:end', {
        sessionId: this.data.id,
        status,
      })
    }
  }

  private allocateTurnIndex(): number {
    const turnIndex = this.nextTurnIndex
    this.nextTurnIndex += 1
    return turnIndex
  }

  private static deriveNextTurnIndex(
    sessionId: string,
    messages: Message[],
    logger?: JsonlLogger,
  ): number {
    const maxLoggedTurnIndex = Session.findMaxLoggedTurnIndex(
      logger?.readSessionRequests(sessionId) ?? [],
    )
    if (maxLoggedTurnIndex > 0) {
      return maxLoggedTurnIndex + 1
    }

    return Session.countRecoverableUserTurns(messages) + 1
  }

  private static findMaxLoggedTurnIndex(entries: RequestLogEntry[]): number {
    return entries.reduce((max, entry) => {
      return Number.isFinite(entry.turnIndex) ? Math.max(max, entry.turnIndex) : max
    }, 0)
  }

  private static countRecoverableUserTurns(messages: Message[]): number {
    return messages.filter((message) => Session.isTopLevelUserTurn(message)).length
  }

  private static isTopLevelUserTurn(message: Message): boolean {
    if (message.role !== 'user') return false
    if (message.content.some((block) => block.type === 'tool_result')) return false

    const hasVisibleContent = message.content.some(
      (block) => block.type === 'text' || block.type === 'image',
    )
    if (!hasVisibleContent) return false

    const textBlocks = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
    if (textBlocks.length === 0) return true

    return !textBlocks.every((text) => Session.isInternalControlText(text))
  }

  private static isInternalControlText(text: string): boolean {
    return (
      text === EMPTY_RESPONSE_RETRY_PROMPT ||
      text === CONTINUATION_PROMPT ||
      text === TASK_CLOSURE_PROMPT ||
      text.startsWith('<queued_message>') ||
      text.startsWith('<queued_messages ')
    )
  }
}
