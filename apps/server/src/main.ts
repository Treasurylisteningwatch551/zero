import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Channel, FeishuStreamingSession } from '@zero-os/channel'
import { FeishuChannel, TelegramChannel, WebChannel } from '@zero-os/channel'
import { CONTEXT_PARAMS, loadConfig, loadFuseList } from '@zero-os/core'
import {
  BashTool,
  CodexTool,
  EditTool,
  FetchTool,
  MemoryGetTool,
  MemorySearchTool,
  MemoryTool,
  ReadTool,
  ScheduleTool,
  TaskTool,
  ToolRegistry,
  WriteTool,
} from '@zero-os/core'
import { SessionManager } from '@zero-os/core'
import {
  EmbeddingClient,
  IndexedMemoryStore,
  MemoManager,
  MemoryRetriever,
  MemoryStore,
  VectorIndex,
} from '@zero-os/memory'
import type { MemoryRepository } from '@zero-os/memory'
import { LiteLLMPricing, ModelRouter } from '@zero-os/model'
import { MetricsDB, ObservabilityStore, SessionDB, Tracer } from '@zero-os/observe'
import { CronScheduler } from '@zero-os/scheduler'
import { Vault, generateMasterKey, getMasterKey, setMasterKey } from '@zero-os/secrets'
import { OutputSecretFilter } from '@zero-os/secrets'
import {
  type ChannelInstanceConfig,
  type Notification,
  type ScheduleConfig,
  type SessionSource,
  installConsoleTimestamping,
} from '@zero-os/shared'
import { RepairEngine } from '@zero-os/supervisor'
import { HeartbeatWriter } from '@zero-os/supervisor'
import { globalBus } from './bus'
import { canRunTelegramRestart, syncTelegramCommandMenu } from './telegram-menu'
import { createTelegramStreamFlusher, reconcileTelegramFinalText } from './telegram-streaming'
import { rebuildWebBundle } from './web-build'

export interface StartOptions {
  dataDir?: string
  skipProcessExit?: boolean
  onCoreReady?: (zero: ZeroOS) => Promise<void> | void
}

interface FeishuStreamingStarterChannel {
  replyStreaming(messageId: string): Promise<FeishuStreamingSession>
  sendStreaming(chatId: string): Promise<FeishuStreamingSession>
}

export function createFeishuStreamingStarter(
  channel: FeishuStreamingStarterChannel,
  chatId: string,
  replyToMessageId?: string,
): () => Promise<FeishuStreamingSession> {
  return () =>
    replyToMessageId ? channel.replyStreaming(replyToMessageId) : channel.sendStreaming(chatId)
}

interface ChannelRuntimeDefinition {
  name: string
  type: 'web' | 'feishu' | 'telegram'
  configured: boolean
  receiveNotifications: boolean
  secretRefs: string[]
}

interface FeishuRuntimeDefinition extends ChannelRuntimeDefinition {
  type: 'feishu'
  credentials?: {
    appId: string
    appSecret: string
    encryptKey?: string
    verificationToken?: string
  }
}

interface TelegramRuntimeDefinition extends ChannelRuntimeDefinition {
  type: 'telegram'
  credentials?: {
    botToken: string
  }
}

type ExternalChannelRuntimeDefinition = FeishuRuntimeDefinition | TelegramRuntimeDefinition

interface RestartSentinelEntry {
  sessionId: string
  source: SessionSource
  channelId: string
  channelName?: string
}

interface RestartSentinelFile {
  ts: string
  sessions: RestartSentinelEntry[]
}

export interface ZeroOS {
  config: ReturnType<typeof loadConfig>
  vault: Vault
  secretFilter: OutputSecretFilter
  observability: ObservabilityStore
  metrics: MetricsDB
  sessionDb: SessionDB
  modelRouter: ModelRouter
  toolRegistry: ToolRegistry
  sessionManager: SessionManager
  memoryStore: MemoryRepository
  memoryRetriever: MemoryRetriever
  memoManager: MemoManager
  tracer: Tracer
  repairEngine: RepairEngine
  heartbeat: HeartbeatWriter
  scheduler: CronScheduler
  bus: typeof globalBus
  channels: Map<string, Channel>
  channelDefinitions: Map<string, ChannelRuntimeDefinition>
  notifications: Notification[]
  addNotification(n: Omit<Notification, 'id' | 'createdAt'>): Notification
  isShuttingDown(): boolean
  shutdown(): Promise<void>
}

export function buildNewSessionReply(
  currentModel: string,
  modelResult?: { success: boolean; message: string },
): string {
  if (!modelResult) {
    return `New conversation started with model: ${currentModel}`
  }
  if (modelResult.success) {
    return `New conversation started with model: ${currentModel}`
  }
  return `New conversation started. ${modelResult.message}`
}

/**
 * Initialize and start ZeRo OS.
 */
export async function startZeroOS(options?: StartOptions): Promise<ZeroOS> {
  installConsoleTimestamping()
  const ZERO_DIR = options?.dataDir ?? process.env.ZERO_DATA_DIR ?? join(process.cwd(), '.zero')
  const startedAt = Date.now()
  console.log('[ZeRo OS] Starting...')

  // 1. Ensure .zero/ directory structure exists
  ensureDirectories(ZERO_DIR)

  // 2. Load master key from Keychain (or create if first run)
  let masterKey: Buffer
  try {
    masterKey = await getMasterKey()
    console.log('[ZeRo OS] Master key loaded from Keychain')
  } catch {
    console.log('[ZeRo OS] First run — generating master key...')
    masterKey = generateMasterKey()
    await setMasterKey(masterKey)
    console.log('[ZeRo OS] Master key stored in Keychain')
  }

  // 3. Decrypt secrets
  const secretsPath = join(ZERO_DIR, 'secrets.enc')
  const vault = new Vault(masterKey, secretsPath)
  vault.load()
  console.log(`[ZeRo OS] Secrets loaded (${vault.keys().length} keys)`)

  // 4. Secret filter
  const secretFilter = new OutputSecretFilter(vault.entries())

  // 5. Load config
  const configPath = join(ZERO_DIR, 'config.yaml')
  const config = loadConfig(configPath)
  console.log(`[ZeRo OS] Config loaded (${Object.keys(config.providers).length} providers)`)

  // 6. Initialize observability, metrics, and session DB
  const logsDir = join(ZERO_DIR, 'logs')
  const observability = new ObservabilityStore(logsDir)
  const metrics = new MetricsDB(join(logsDir, 'metrics.db'))
  const sessionDb = new SessionDB(join(logsDir, 'sessions.db'))
  const tracer = new Tracer(logsDir)
  const heartbeat = new HeartbeatWriter(join(ZERO_DIR, 'heartbeat.json'))
  heartbeat.setReady(false, 'booting')
  heartbeat.start()
  console.log('[ZeRo OS] Logging initialized')
  console.log('[ZeRo OS] Heartbeat writer started')

  // 6.5. Initialize LiteLLM pricing fallback
  const litellmPricing = LiteLLMPricing.init(join(ZERO_DIR, 'cache'))
  await litellmPricing.ensureLoaded()
  litellmPricing.startRefresh()
  console.log('[ZeRo OS] LiteLLM pricing fallback initialized')

  // 7. Initialize Model Router
  const secrets = new Map(vault.entries())
  const modelRouter = new ModelRouter(config, secrets)
  const initResult = modelRouter.init()
  console.log(`[ZeRo OS] Model Router: ${initResult.message}`)

  // 8. Initialize Tools
  const fuseRules = loadFuseList(join(ZERO_DIR, 'fuse_list.yaml'))
  const toolRegistry = new ToolRegistry()
  toolRegistry.register(new ReadTool())
  toolRegistry.register(new WriteTool())
  toolRegistry.register(new EditTool())
  toolRegistry.register(new BashTool(fuseRules))
  toolRegistry.register(new FetchTool())
  toolRegistry.register(new MemorySearchTool())
  toolRegistry.register(new MemoryGetTool())
  toolRegistry.register(new MemoryTool())
  toolRegistry.register(new TaskTool(modelRouter, toolRegistry))
  toolRegistry.register(new ScheduleTool())
  toolRegistry.register(new CodexTool())
  console.log(`[ZeRo OS] ${toolRegistry.list().length} tools registered`)

  // 9. Memory
  const memoryDir = join(ZERO_DIR, 'memory')
  const baseMemoryStore = new MemoryStore(memoryDir)
  let memoryStore: MemoryRepository = baseMemoryStore
  const memoManager = new MemoManager(join(memoryDir, 'memo.md'))
  let embeddingClient: EmbeddingClient | undefined
  let vectorIndex: VectorIndex | undefined

  const embeddingConfig = config.embedding
  if (embeddingConfig?.baseUrl && embeddingConfig.apiKeyRef && embeddingConfig.model) {
    const apiKey = vault.get(embeddingConfig.apiKeyRef)
    if (apiKey) {
      try {
        heartbeat.setReady(false, 'memory_indexing')
        embeddingClient = new EmbeddingClient({
          baseUrl: embeddingConfig.baseUrl,
          apiKey,
          model: embeddingConfig.model,
          dimensions: embeddingConfig.dimensions,
        })
        vectorIndex = new VectorIndex(join(memoryDir, 'vectors'))
        const indexedMemoryStore = new IndexedMemoryStore(
          baseMemoryStore,
          embeddingClient,
          vectorIndex,
        )
        memoryStore = indexedMemoryStore
        const reindexed = await indexedMemoryStore.reindexAll()
        console.log(`[ZeRo OS] Memory vector index ready (${reindexed} items)`)
      } catch (error) {
        embeddingClient = undefined
        vectorIndex = undefined
        memoryStore = baseMemoryStore
        console.warn(
          '[ZeRo OS] Memory vector index unavailable, falling back to keyword retrieval',
          {
            message: error instanceof Error ? error.message : String(error),
          },
        )
      }
    } else {
      console.warn(
        `[ZeRo OS] Embedding secret "${embeddingConfig.apiKeyRef}" not found, memory search will use keyword fallback`,
      )
    }
  }

  const memoryRetriever = new MemoryRetriever(memoryStore, embeddingClient, vectorIndex, {
    vectorWeight: CONTEXT_PARAMS.retrieval.vectorWeight,
    keywordWeight: CONTEXT_PARAMS.retrieval.keywordWeight,
    recencyWeight: CONTEXT_PARAMS.retrieval.recencyWeight,
    recencyHalfLifeDays: CONTEXT_PARAMS.retrieval.recencyHalfLifeDays,
  })

  // 9.5 Identity reader — hot-reloads identity on each turn per agent name
  const identityReader = (agentName: string) => {
    const globalPref = memoryStore.list('preference').find((m) => m.id === 'pref_global')
    return {
      global: globalPref?.content ?? '',
      agent: memoryStore.getAgentPreference(agentName),
    }
  }

  // 10. Session Manager — pass observability deps, memory, bus, secret filter, and identity
  const secretResolver = (ref: string) => vault.get(ref) ?? undefined
  // Pre-create scheduler + handles (trigger handler set later after sessionManager exists)
  const scheduler = new CronScheduler()
  const schedulerHandle = {
    addAndStart: (c: ScheduleConfig) => scheduler.addAndStart(c),
    remove: (n: string) => scheduler.remove(n),
    getStatus: () => scheduler.getStatus(),
  }
  const scheduleStore = {
    save: (c: ScheduleConfig) => sessionDb.saveSchedule(c),
    delete: (n: string) => sessionDb.deleteSchedule(n),
  }

  const sessionManager = new SessionManager(
    modelRouter,
    toolRegistry,
    {
      observability,
      metrics,
      tracer,
      secretFilter,
      secretResolver,
      memoryRetriever,
      memoryStore,
      identityReader,
      bus: globalBus,
      sessionDb,
      schedulerHandle,
      scheduleStore,
    },
    sessionDb,
  )

  // 10.5. Restore active sessions from DB
  heartbeat.setReady(false, 'restoring_sessions')
  const restoredCount = sessionManager.restoreFromDB()
  if (restoredCount > 0) {
    console.log(`[ZeRo OS] Restored ${restoredCount} sessions from DB`)
  }

  // 11. Repair Engine
  const repairEngine = new RepairEngine()

  // 13. Scheduler — trigger handler (scheduler + handles created in step 10)
  heartbeat.setReady(false, 'starting_channels')
  const channels = new Map<string, Channel>()
  const channelDefinitions = new Map<string, ChannelRuntimeDefinition>()

  heartbeat.setHealthMetricsProvider(() => ({
    channels: Array.from(channels.entries()).map(([name, channel]) => ({
      name,
      type: channel.type,
      connected: channel.isConnected(),
      configured: channelDefinitions.get(name)?.configured ?? channel.type === 'web',
    })),
  }))
  heartbeat.setOnWrite((data) => {
    globalBus.emit('heartbeat', {
      status: data.health.status,
      channels: data.channels,
      disconnectedChannels: data.health.channels.offline,
      timestamp: data.timestamp,
    })
  })
  heartbeat.write()

  scheduler.setTriggerHandler(async (schedConfig) => {
    const binding = schedConfig.channel
    let session: import('@zero-os/core').Session

    if (binding) {
      const result = sessionManager.getOrCreateForChannel(
        binding.source as SessionSource,
        binding.channelId,
        binding.channelName,
      )
      session = result.session
      if (result.isNew) {
        session.initAgent({
          name: `schedule-${schedConfig.name}`,
          agentInstruction: schedConfig.instruction,
        })
      }
    } else {
      session = sessionManager.create('scheduler')
      session.initAgent({
        name: `schedule-${schedConfig.name}`,
        agentInstruction: schedConfig.instruction,
      })
    }

    const replies = await session.handleMessage(schedConfig.instruction)

    // Deliver result back to originating channel
    if (binding) {
      const channel = channels.get(binding.channelName)
      const text = collectAssistantReply(replies)
      if (channel?.isConnected() && text) {
        await channel.send(binding.channelId, text).catch((err) => {
          console.error(
            `[Scheduler] delivery to ${binding.channelName}:${binding.channelId} failed:`,
            err,
          )
          addNotification({
            type: 'system',
            severity: 'warn',
            title: `Schedule "${schedConfig.name}" delivery failed`,
            description: text.slice(0, 500),
            source: 'scheduler',
            sessionId: session.data.id,
            actionable: false,
          })
        })
      } else if (text) {
        addNotification({
          type: 'system',
          severity: 'info',
          title: `Schedule "${schedConfig.name}" completed (channel offline)`,
          description: text.slice(0, 500),
          source: 'scheduler',
          sessionId: session.data.id,
          actionable: false,
        })
      }
    }
  })

  // Clean up DB when oneShot schedule auto-removes
  scheduler.setOnRemoved((name) => {
    sessionDb.deleteSchedule(name)
  })

  // Load config-based schedules
  for (const s of config.schedules) {
    scheduler.add({ ...s, createdBy: 'config' as const })
  }

  // Load runtime-created (channel-bound) schedules from DB
  const runtimeSchedules = sessionDb.loadRuntimeSchedules()
  for (const s of runtimeSchedules) {
    scheduler.add(s)
  }

  scheduler.start()
  const totalSchedules = config.schedules.length + runtimeSchedules.length
  console.log(
    `[ZeRo OS] Scheduler started (${totalSchedules} schedules: ${config.schedules.length} config + ${runtimeSchedules.length} runtime)`,
  )

  // 14. Notification store
  const notifications: Notification[] = []
  const notificationsPath = join(ZERO_DIR, 'logs', 'notifications.jsonl')

  // Load persisted notifications
  if (existsSync(notificationsPath)) {
    const lines = readFileSync(notificationsPath, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        notifications.push(JSON.parse(line))
      } catch {}
    }
  }

  function addNotification(n: Omit<Notification, 'id' | 'createdAt'>): Notification {
    const notification: Notification = {
      ...n,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }
    notifications.push(notification)
    // Persist to JSONL
    appendFileSync(notificationsPath, `${JSON.stringify(notification)}\n`)
    // Emit to bus so WS clients receive it
    globalBus.emit('notification', {
      notification,
      event: 'notification:new',
    })
    // Push to explicitly opted-in channels — send to each active conversation
    for (const [name, ch] of channels) {
      const definition = channelDefinitions.get(name)
      if (!definition?.receiveNotifications || !ch.isConnected() || ch.type === 'web') continue
      const chatIds = sessionManager.getActiveChannelIds(definition.type as SessionSource, name)
      const text = `[notification]${notification.title}: ${notification.description}`
      for (const chatId of chatIds) {
        ch.send(chatId, text).catch(() => {})
      }
    }
    return notification
  }

  // Helper: extract text from an assistant Message
  function extractAssistantText(msg: import('@zero-os/shared').Message): string {
    if (msg.role !== 'assistant') return ''
    return msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim()
  }

  function collectAssistantReply(messages: import('@zero-os/shared').Message[]): string {
    return messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => m.content)
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim()
  }

  function describeError(err: unknown): string {
    if (err instanceof Error) return err.message
    if (typeof err === 'string') return err
    if (!err || typeof err !== 'object') return String(err)

    const record = err as Record<string, unknown>
    const response =
      typeof record.response === 'object' && record.response !== null
        ? (record.response as Record<string, unknown>)
        : undefined
    const config =
      typeof record.config === 'object' && record.config !== null
        ? (record.config as Record<string, unknown>)
        : undefined

    const parts = [
      typeof response?.status === 'number' ? `status=${response.status}` : '',
      typeof config?.method === 'string' || typeof config?.url === 'string'
        ? `${typeof config?.method === 'string' ? config.method.toUpperCase() : 'REQUEST'} ${typeof config?.url === 'string' ? config.url : ''}`.trim()
        : '',
      typeof record.message === 'string' ? record.message : '',
    ].filter(Boolean)

    return parts.join(' | ') || '[unknown error]'
  }

  function isRestartCommand(content: string): boolean {
    if (Date.now() - startedAt < 15_000) return false // ignore during startup grace period
    return /^\/restart(?:@\S+)?$/i.test(content.trim())
  }

  function parseNewSessionCommand(content: string): { modelArg?: string } | null {
    const trimmed = content.trim()
    const match = trimmed.match(/^\/new(?:@\S+)?(?:\s+(.+))?$/i)
    if (!match) return null
    const modelArg = match[1]?.trim()
    return modelArg ? { modelArg } : {}
  }

  // 15. Channel registry (channels Map declared earlier with scheduler)

  // Web channel — always registered
  const webChannel = new WebChannel()
  await webChannel.start()
  channels.set('web', webChannel)
  channelDefinitions.set('web', {
    name: 'web',
    type: 'web',
    configured: true,
    receiveNotifications: false,
    secretRefs: [],
  })
  heartbeat.write()

  let shuttingDown = false
  const restartSentinelPath = join(ZERO_DIR, 'restart-sentinel.json')
  const shouldPersistBusEvent = (payload: { topic: string; data: Record<string, unknown> }) => {
    switch (payload.topic) {
      case 'session:create':
      case 'session:end':
      case 'model:switch':
      case 'notification':
      case 'repair:start':
      case 'repair:end':
      case 'fuse:trigger':
        return true
      case 'session:update':
        return (
          payload.data.event === 'task_closure_decision' ||
          payload.data.event === 'task_closure_failed'
        )
      default:
        return false
    }
  }
  const wildcardLogListener = (payload: { topic: string; data: Record<string, unknown> }) => {
    if (!shouldPersistBusEvent(payload)) return
    observability.log('info', payload.topic, payload.data)
  }
  const repairMetricsListener = (payload: { data: Record<string, unknown> }) => {
    metrics.recordRepair({
      sessionId: payload.data.sessionId as string | undefined,
      status: (payload.data.status as string) === 'success' ? 'success' : 'failed',
      diagnosis: (payload.data.diagnosis as string) ?? '',
      action: (payload.data.action as string) ?? '',
      result: (payload.data.result as string) ?? '',
    })
  }
  const toolMetricsListener = (payload: { data: Record<string, unknown>; timestamp: string }) => {
    const sessionId = payload.data.sessionId as string | undefined
    if (!sessionId) return

    metrics.recordOperation({
      sessionId,
      tool: (payload.data.tool as string) ?? '',
      event: 'tool:call',
      success: true,
      durationMs: 0,
      createdAt: payload.timestamp,
    })
  }

  globalBus.on('*', wildcardLogListener)
  globalBus.on('repair:end', repairMetricsListener)
  globalBus.on('tool:call', toolMetricsListener)

  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\n[ZeRo OS] Shutting down...')
    scheduler.stop()
    console.log('[ZeRo OS] Scheduler stopped')

    const interruptedSessions = await sessionManager.drainAndCollectInterrupted(30_000)
    if (interruptedSessions.length > 0) {
      const sentinel: RestartSentinelFile = {
        ts: new Date().toISOString(),
        sessions: interruptedSessions.filter(
          (session): session is RestartSentinelEntry =>
            typeof session.channelId === 'string' && session.source !== 'scheduler',
        ),
      }
      if (sentinel.sessions.length > 0) {
        writeFileSync(restartSentinelPath, JSON.stringify(sentinel))
        console.log(
          `[ZeRo OS] Restart sentinel recorded ${sentinel.sessions.length} interrupted session(s)`,
        )
      }
    }

    globalBus.off('*', wildcardLogListener)
    globalBus.off('repair:end', repairMetricsListener)
    globalBus.off('tool:call', toolMetricsListener)
    litellmPricing.dispose()
    console.log('[ZeRo OS] LiteLLM pricing disposed')
    for (const [, ch] of channels) {
      try {
        await ch.stop()
      } catch {}
    }
    console.log('[ZeRo OS] Channels closed')
    heartbeat.stop()
    console.log('[ZeRo OS] Heartbeat stopped')
    sessionManager.flushAll()
    console.log('[ZeRo OS] Sessions flushed to DB')
    sessionDb.close()
    console.log('[ZeRo OS] Session DB closed')
    metrics.close()
    console.log('[ZeRo OS] Metrics DB closed')
    console.log('[ZeRo OS] Shutdown complete.')
    if (!options?.skipProcessExit) process.exit(0)
  }

  const zero: ZeroOS = {
    config,
    vault,
    secretFilter,
    observability,
    metrics,
    sessionDb,
    modelRouter,
    toolRegistry,
    sessionManager,
    memoryStore,
    memoryRetriever,
    memoManager,
    tracer,
    repairEngine,
    heartbeat,
    scheduler,
    bus: globalBus,
    channels,
    channelDefinitions,
    notifications,
    addNotification,
    isShuttingDown: () => shuttingDown,
    shutdown,
  }

  await options?.onCoreReady?.(zero)

  const externalChannelDefinitions = buildExternalChannelDefinitions(config.channels, vault)

  for (const definition of externalChannelDefinitions) {
    channelDefinitions.set(definition.name, definition)

    if (definition.type === 'feishu') {
      const feishuChannel = new FeishuChannel({
        name: definition.name,
        appId: definition.credentials?.appId ?? '',
        appSecret: definition.credentials?.appSecret ?? '',
        encryptKey: definition.credentials?.encryptKey,
        verificationToken: definition.credentials?.verificationToken,
      })

      if (definition.credentials) {
        const channelName = definition.name
        const agentName = buildAgentName(channelName)

        feishuChannel.setMessageHandler(async (msg) => {
          const chatId = (msg.metadata?.chatId as string) ?? msg.senderId
          const messageId = msg.metadata?.messageId as string
          let activeSessionId: string | null = null
          let typingReactionId: string | null = null
          let streaming: FeishuStreamingSession | null = null

          try {
            if (shuttingDown) {
              console.log(`[ZeRo OS] Ignoring ${channelName} message during shutdown`)
              return
            }

            if (isRestartCommand(msg.content)) {
              const reply = 'Restarting ZeRo OS...'
              if (messageId) {
                await feishuChannel.reply(messageId, reply)
              } else {
                await feishuChannel.send(chatId, reply)
              }
              setTimeout(() => shutdown(), 500)
              return
            }

            const newCommand = parseNewSessionCommand(msg.content)
            if (newCommand) {
              const { session } = sessionManager.startNewForChannel('feishu', chatId, {
                channelName,
              })
              activeSessionId = session.data.id
              const modelResult = newCommand.modelArg
                ? await session.switchModel(newCommand.modelArg)
                : undefined
              session.initAgent({
                name: agentName,
                agentInstruction:
                  'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
              })

              const replyText = buildNewSessionReply(session.data.currentModel, modelResult)
              if (messageId) {
                await feishuChannel.reply(messageId, replyText)
              } else {
                await feishuChannel.send(chatId, replyText)
              }
              return
            }

            const { session, isNew } = sessionManager.getOrCreateForChannel(
              'feishu',
              chatId,
              channelName,
            )
            activeSessionId = session.data.id
            if (isNew) {
              session.setChannelCapabilities(feishuChannel.getCapabilities())
              session.initAgent({
                name: agentName,
                agentInstruction:
                  'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
              })
            }

            typingReactionId = messageId ? await feishuChannel.react(messageId, 'Typing') : null
            const startStreaming = createFeishuStreamingStarter(feishuChannel, chatId, messageId)

            try {
              streaming = await startStreaming()
            } catch (err) {
              console.warn(
                `[ZeRo OS] ${channelName} streaming init failed, falling back to static:`,
                describeError(err),
              )
            }

            let firstReply = true
            let lastSentMsgId: string | null = null
            let lastProgressText: string | null = null
            // True streaming: accumulate deltas per card, new card per turn
            let streamText = ''
            let seenDelta = false
            let lastTurnId: string | null = null
            // Queue for completing previous cards before creating new ones
            let turnRotateChain: Promise<void> = Promise.resolve()

            const replies = await session.handleMessage(msg.content, {
              images: msg.images,
              onTextDelta: streaming
                ? (delta, meta) => {
                    if (!delta) return
                    seenDelta = true

                    // New turn → complete current card, start a new one
                    if (lastTurnId && lastTurnId !== meta.turnId && streamText) {
                      const prevText = streamText
                      streamText = ''
                      turnRotateChain = turnRotateChain.then(async () => {
                        try {
                          await streaming!.complete(prevText)
                          streaming = await startStreaming()
                        } catch (err) {
                          console.error(
                            `[ZeRo OS] ${channelName} streaming turn rotate error:`,
                            describeError(err),
                          )
                        }
                      })
                    }
                    lastTurnId = meta.turnId
                    streamText += delta
                    const textSnapshot = streamText
                    turnRotateChain = turnRotateChain.then(() =>
                      streaming!.update(textSnapshot).catch((err) =>
                        console.error(
                          `[ZeRo OS] ${channelName} streaming update error:`,
                          describeError(err),
                        ),
                      ),
                    )
                  }
                : undefined,
              onProgress: (newMsg) => {
                const text = extractAssistantText(newMsg)
                if (!text) return

                // When streaming is active, onTextDelta handles the card updates.
                // onProgress still tracks lastSentMsgId for bookkeeping.
                if (streaming) {
                  lastSentMsgId = newMsg.id
                  // If onTextDelta didn't fire (e.g. non-streaming model), use onProgress as fallback
                  if (!seenDelta && text !== lastProgressText) {
                    lastProgressText = text
                    streamText = streamText ? `${streamText}\n\n${text}` : text
                    const textSnapshot = streamText
                    turnRotateChain = turnRotateChain.then(() =>
                      streaming!.update(textSnapshot).catch((err) =>
                        console.error(
                          `[ZeRo OS] ${channelName} streaming update error:`,
                          describeError(err),
                        ),
                      ),
                    )
                  }
                  return
                }

                if (text === lastProgressText) return
                lastProgressText = text
                lastSentMsgId = newMsg.id

                if (firstReply && messageId) {
                  firstReply = false
                  feishuChannel
                    .reply(messageId, text)
                    .catch((err) =>
                      console.error(
                        `[ZeRo OS] ${channelName} progressive send error:`,
                        describeError(err),
                      ),
                    )
                } else {
                  feishuChannel
                    .send(chatId, text)
                    .catch((err) =>
                      console.error(
                        `[ZeRo OS] ${channelName} progressive send error:`,
                        describeError(err),
                      ),
                    )
                }
              },
            })

            // Wait for any pending turn rotations
            await turnRotateChain
            const imageBlocks = replies
              .filter((m) => m.role === 'assistant')
              .flatMap((m) => m.content)
              .filter((b): b is import('@zero-os/shared').ImageBlock => b.type === 'image')

            let imageMarkdownSuffix = ''
            const shouldEmbedImageBlocks = Boolean(streaming) || !lastSentMsgId
            let failedImageBlocks: import('@zero-os/shared').ImageBlock[] = []
            if (imageBlocks.length > 0 && shouldEmbedImageBlocks) {
              const uploadResults = await Promise.all(
                imageBlocks.map(async (img, i) => {
                  try {
                    const imageBuffer = Buffer.from(img.data, 'base64')
                    const imageKey = await feishuChannel.uploadImage(imageBuffer)
                    return { imageKey, block: img }
                  } catch (imgErr) {
                    console.warn(
                      `[ZeRo OS] ${channelName} failed to upload image block ${i}:`,
                      describeError(imgErr),
                    )
                    return { imageKey: null, block: img }
                  }
                }),
              )

              const uploadedKeys = uploadResults
                .map((result) => result.imageKey)
                .filter((key): key is string => key !== null)
              failedImageBlocks = uploadResults
                .filter((result) => result.imageKey === null)
                .map((result) => result.block)

              if (uploadedKeys.length > 0) {
                imageMarkdownSuffix =
                  '\n\n' +
                  uploadedKeys.map((key, i) => `![image-${i + 1}](${key})`).join('\n\n')
              }
            }

            if (streaming) {
              const finalText = (streamText || collectAssistantReply(replies)) + imageMarkdownSuffix
              if (finalText) {
                await streaming.complete(finalText)
              }
            } else if (!lastSentMsgId) {
              const replyText = collectAssistantReply(replies) + imageMarkdownSuffix
              if (replyText && messageId) {
                await feishuChannel.reply(messageId, replyText)
              } else if (replyText) {
                await feishuChannel.send(chatId, replyText)
              }
            }

            const fallbackImageBlocks = shouldEmbedImageBlocks ? failedImageBlocks : imageBlocks
            if (fallbackImageBlocks.length > 0) {
              for (const img of fallbackImageBlocks) {
                try {
                  const imageBuffer = Buffer.from(img.data, 'base64')
                  await feishuChannel.sendImage(chatId, imageBuffer)
                } catch (imgErr) {
                  console.warn(
                    `[ZeRo OS] ${channelName} failed to send image block:`,
                    describeError(imgErr),
                  )
                }
              }
            }

            if (messageId) {
              if (typingReactionId)
                feishuChannel.removeReaction(messageId, typingReactionId).catch(() => {})
              feishuChannel.react(messageId, 'DONE').catch(() => {})
            }
          } catch (err) {
            console.error(`[ZeRo OS] ${channelName} message handler error:`, describeError(err))
            const errorMessage = err instanceof Error ? err.message : String(err)
            let sessionWasArchived = false

            if (
              activeSessionId &&
              errorMessage.includes('No tool output found for function call')
            ) {
              const poisonedSession = sessionManager.get(activeSessionId)
              if (poisonedSession) {
                poisonedSession.setStatus('archived')
              }
              sessionManager.remove(activeSessionId)
              sessionWasArchived = true
              console.warn(
                `[ZeRo OS] Archived poisoned ${channelName} session after tool output mismatch:`,
                activeSessionId,
              )
            }

            const userReply = sessionWasArchived
              ? 'Session corrupted and has been reset. Please resend your message.'
              : 'An error occurred processing your message.'

            try {
              if (streaming) {
                streaming.abort(userReply).catch(() => {})
              }
              if (messageId) {
                if (typingReactionId)
                  feishuChannel.removeReaction(messageId, typingReactionId).catch(() => {})
                if (!streaming) {
                  await feishuChannel.reply(messageId, userReply)
                }
              } else if (!streaming) {
                await feishuChannel.send(chatId, userReply)
              }
            } catch {}
          }
        })

        await feishuChannel.start()
        console.log(`[ZeRo OS] Channel started: ${definition.name}`)
      }

      channels.set(definition.name, feishuChannel)
      heartbeat.write()
      continue
    }

    const telegramChannel = new TelegramChannel({
      name: definition.name,
      botToken: definition.credentials?.botToken ?? '',
    })

    if (definition.credentials) {
      const channelName = definition.name
      const agentName = buildAgentName(channelName)

      telegramChannel.setMessageHandler(async (msg) => {
        const chatId = (msg.metadata?.chatId as string) ?? msg.senderId
        const messageId = msg.metadata?.messageId as number | undefined
        const chatType = msg.metadata?.chatType
        let activeSessionId: string | null = null

        try {
          if (shuttingDown) {
            console.log(`[ZeRo OS] Ignoring ${channelName} message during shutdown`)
            return
          }

          if (isRestartCommand(msg.content)) {
            if (!canRunTelegramRestart(chatType)) {
              const reply = 'The /restart command is only available in private chats.'
              if (messageId) {
                await telegramChannel.replyRich(chatId, messageId, reply)
              } else {
                await telegramChannel.sendRich(chatId, reply)
              }
              return
            }

            const reply = 'Rebuilding web UI and restarting ZeRo OS...'
            if (messageId) {
              await telegramChannel.replyRich(chatId, messageId, reply)
            } else {
              await telegramChannel.sendRich(chatId, reply)
            }

            const build = rebuildWebBundle()
            if (!build.ok) {
              const failureReply = `Web rebuild failed, restart cancelled: ${build.error ?? 'unknown error'}`
              if (messageId) {
                await telegramChannel.replyRich(chatId, messageId, failureReply)
              } else {
                await telegramChannel.sendRich(chatId, failureReply)
              }
              return
            }

            setTimeout(() => shutdown(), 500)
            return
          }

          const newCommand = parseNewSessionCommand(msg.content)
          if (newCommand) {
            const { session } = sessionManager.startNewForChannel('telegram', chatId, {
              channelName,
            })
            activeSessionId = session.data.id
            const modelResult = newCommand.modelArg
              ? await session.switchModel(newCommand.modelArg)
              : undefined
            session.initAgent({
              name: agentName,
              agentInstruction:
                'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
            })
            const replyText = buildNewSessionReply(session.data.currentModel, modelResult)
            if (messageId) {
              await telegramChannel.replyRich(chatId, messageId, replyText)
            } else {
              await telegramChannel.sendRich(chatId, replyText)
            }
            return
          }

          telegramChannel.sendTyping(chatId).catch(() => {})
          if (messageId) {
            telegramChannel.react(chatId, messageId, '👀').catch(() => {})
          }

          const { session, isNew } = sessionManager.getOrCreateForChannel(
            'telegram',
            chatId,
            channelName,
          )
          activeSessionId = session.data.id
          if (isNew) {
            session.setChannelCapabilities(telegramChannel.getCapabilities())
            session.initAgent({
              name: agentName,
              agentInstruction:
                'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
            })
          }

          let streamText = ''
          let seenDelta = false
          let lastTurnId: string | null = null

          const streamFlusher = createTelegramStreamFlusher({
            minIntervalMs: 350,
            getText: () => streamText,
            sendInitial: async (text) => {
              const sent = messageId
                ? await telegramChannel.replyRich(chatId, messageId, text)
                : await telegramChannel.sendRich(chatId, text)
              return sent?.message_id ?? null
            },
            edit: async (sentMessageId, text) => {
              await telegramChannel.editRich(chatId, sentMessageId, text)
            },
          })

          const replies = await session.handleMessage(msg.content, {
            images: msg.images,
            onTextDelta: (delta, meta) => {
              if (!delta) return
              seenDelta = true
              if (lastTurnId && lastTurnId !== meta.turnId && streamText) {
                streamText += '\n'
              }
              lastTurnId = meta.turnId
              streamText += delta
              telegramChannel.sendTyping(chatId).catch(() => {})
              streamFlusher
                .flush(false)
                .catch((err) =>
                  console.error(`[ZeRo OS] ${channelName} streaming flush error:`, err),
                )
            },
            onProgress: (newMsg) => {
              const text = extractAssistantText(newMsg)
              if (!text || seenDelta) return
              streamText = streamText ? `${streamText}\n${text}` : text
            },
          })

          const finalReply = collectAssistantReply(replies)
          streamText = reconcileTelegramFinalText(streamText, finalReply)

          if (streamText) {
            try {
              await streamFlusher.flush(true)
            } catch (err) {
              console.error(`[ZeRo OS] ${channelName} final flush failed, fallback to sendRich:`, {
                sessionId: session.data.id,
                chatId,
                messageId: messageId ?? null,
                error: err instanceof Error ? err.message : String(err),
              })
              await telegramChannel.sendRich(chatId, streamText)
            }
          } else if (finalReply) {
            if (messageId) {
              await telegramChannel.replyRich(chatId, messageId, finalReply)
            } else {
              await telegramChannel.sendRich(chatId, finalReply)
            }
          }

          if (messageId) {
            telegramChannel.react(chatId, messageId, '✅').catch(() => {})
          }
        } catch (err) {
          console.error(`[ZeRo OS] ${channelName} message handler error:`, err)
          const errorMessage = err instanceof Error ? err.message : String(err)
          let sessionWasArchived = false

          if (activeSessionId && errorMessage.includes('No tool output found for function call')) {
            const poisonedSession = sessionManager.get(activeSessionId)
            if (poisonedSession) {
              poisonedSession.setStatus('archived')
            }
            sessionManager.remove(activeSessionId)
            sessionWasArchived = true
            console.warn(
              `[ZeRo OS] Archived poisoned ${channelName} session after tool output mismatch:`,
              activeSessionId,
            )
          }

          const userReply = sessionWasArchived
            ? 'Session corrupted and has been reset. Please resend your message.'
            : 'An error occurred processing your message.'

          if (messageId) {
            telegramChannel.react(chatId, messageId, '❌').catch(() => {})
          }

          try {
            if (messageId) {
              await telegramChannel.replyRich(chatId, messageId, userReply)
            } else {
              await telegramChannel.sendRich(chatId, userReply)
            }
          } catch {}
        }
      })

      await telegramChannel.start()

      try {
        await syncTelegramCommandMenu(telegramChannel)
        console.log(`[ZeRo OS] ${definition.name} commands/menu synced`)
      } catch (err) {
        console.warn(`[ZeRo OS] ${definition.name} commands/menu sync failed:`, err)
      }

      console.log(`[ZeRo OS] Channel started: ${definition.name}`)
    }

    channels.set(definition.name, telegramChannel)
    heartbeat.write()
  }

  console.log(`[ZeRo OS] ${channels.size} channels registered`)

  if (existsSync(restartSentinelPath)) {
    try {
      const sentinel = JSON.parse(readFileSync(restartSentinelPath, 'utf-8')) as RestartSentinelFile
      unlinkSync(restartSentinelPath)

      if (Array.isArray(sentinel.sessions) && sentinel.sessions.length > 0) {
        console.log(
          `[ZeRo OS] Restart sentinel found ${sentinel.sessions.length} interrupted session(s)`,
        )

        for (const entry of sentinel.sessions) {
          void (async () => {
            const session = sessionManager.get(entry.sessionId)
            if (!session) return

            const channel = entry.channelName ? channels.get(entry.channelName) : undefined
            if (!channel || !channel.isConnected()) return

            if (!session.getAgentConfig()) {
              console.warn(
                `[ZeRo OS] Restart sentinel skipped session without agent config: ${entry.sessionId}`,
              )
              return
            }

            try {
              session.setChannelCapabilities(channel.getCapabilities() as Record<string, unknown>)
              const replies = await session.handleMessage(
                '[System] The process restarted while your previous turn was still running. Continue the interrupted task from the existing conversation context. If the task is already complete, briefly confirm completion.',
              )
              const replyText = collectAssistantReply(replies)
              if (replyText) {
                await channel.send(entry.channelId, replyText)
              }
            } catch (error) {
              console.warn(
                `[ZeRo OS] Restart sentinel failed to resume session ${entry.sessionId}:`,
                describeError(error),
              )
            }
          })()
        }
      }
    } catch (error) {
      console.warn('[ZeRo OS] Failed to read restart sentinel:', describeError(error))
    }
  }

  heartbeat.setReady(true, 'ready')
  heartbeat.write()
  console.log('[ZeRo OS] System ready.')

  globalBus.emit('session:create', { event: 'system_start' })

  return zero
}

function buildExternalChannelDefinitions(
  configuredChannels: ChannelInstanceConfig[] | undefined,
  vault: Vault,
): ExternalChannelRuntimeDefinition[] {
  if (configuredChannels) {
    return configuredChannels.reduce<ExternalChannelRuntimeDefinition[]>((definitions, channel) => {
      if (channel.enabled === false || channel.type === 'web') {
        return definitions
      }

      if (channel.type === 'feishu') {
        const appId = vault.get(channel.appIdRef)
        const appSecret = vault.get(channel.appSecretRef)

        definitions.push({
          name: channel.name,
          type: 'feishu' as const,
          configured: !!(appId && appSecret),
          receiveNotifications: channel.receiveNotifications ?? false,
          secretRefs: [
            channel.appIdRef,
            channel.appSecretRef,
            ...(channel.encryptKeyRef ? [channel.encryptKeyRef] : []),
            ...(channel.verificationTokenRef ? [channel.verificationTokenRef] : []),
          ],
          credentials:
            appId && appSecret
              ? {
                  appId,
                  appSecret,
                  encryptKey: channel.encryptKeyRef
                    ? (vault.get(channel.encryptKeyRef) ?? undefined)
                    : undefined,
                  verificationToken: channel.verificationTokenRef
                    ? (vault.get(channel.verificationTokenRef) ?? undefined)
                    : undefined,
                }
              : undefined,
        })
        return definitions
      }

      if (channel.type !== 'telegram') return definitions

      const botToken = vault.get(channel.botTokenRef)
      definitions.push({
        name: channel.name,
        type: 'telegram' as const,
        configured: !!botToken,
        receiveNotifications: channel.receiveNotifications ?? false,
        secretRefs: [channel.botTokenRef],
        credentials: botToken ? { botToken } : undefined,
      })
      return definitions
    }, [])
  }

  const feishuAppId = vault.get('feishu_app_id')
  const feishuAppSecret = vault.get('feishu_app_secret')
  const telegramToken = vault.get('telegram_bot_token')

  return [
    {
      name: 'feishu',
      type: 'feishu',
      configured: !!(feishuAppId && feishuAppSecret),
      receiveNotifications: false,
      secretRefs: [
        'feishu_app_id',
        'feishu_app_secret',
        'feishu_encrypt_key',
        'feishu_verification_token',
      ],
      credentials:
        feishuAppId && feishuAppSecret
          ? {
              appId: feishuAppId,
              appSecret: feishuAppSecret,
              encryptKey: vault.get('feishu_encrypt_key') ?? undefined,
              verificationToken: vault.get('feishu_verification_token') ?? undefined,
            }
          : undefined,
    },
    {
      name: 'telegram',
      type: 'telegram',
      configured: !!telegramToken,
      receiveNotifications: false,
      secretRefs: ['telegram_bot_token'],
      credentials: telegramToken ? { botToken: telegramToken } : undefined,
    },
  ]
}

function buildAgentName(channelName: string): string {
  return `zero-${channelName.replace(/[^a-z0-9_-]+/gi, '-')}`
}

function ensureDirectories(ZERO_DIR: string): void {
  const dirs = [
    ZERO_DIR,
    join(ZERO_DIR, 'channels'),
    join(ZERO_DIR, 'tools'),
    join(ZERO_DIR, 'skills'),
    join(ZERO_DIR, 'skills', 'browser'),
    join(ZERO_DIR, 'logs'),
    join(ZERO_DIR, 'memory'),
    join(ZERO_DIR, 'memory/preferences'),
    join(ZERO_DIR, 'memory/preferences/agents'),
    join(ZERO_DIR, 'memory/sessions'),
    join(ZERO_DIR, 'memory/incidents'),
    join(ZERO_DIR, 'memory/runbooks'),
    join(ZERO_DIR, 'memory/decisions'),
    join(ZERO_DIR, 'memory/notes'),
    join(ZERO_DIR, 'memory/inbox'),
    join(ZERO_DIR, 'memory/archive'),
    join(ZERO_DIR, 'cache'),
    join(ZERO_DIR, 'workspace'),
    join(ZERO_DIR, 'workspace/shared'),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
}

// Auto-start if run directly
if (import.meta.main) {
  startZeroOS().catch(console.error)
}
