import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, loadFuseList } from '@zero-os/core'
import { ModelRouter } from '@zero-os/model'
import { ToolRegistry, ReadTool, WriteTool, EditTool, BashTool, BrowserTool, TaskTool } from '@zero-os/core'
import { Mutex } from '@zero-os/shared'
import { SessionManager } from '@zero-os/core'
import { Vault, generateMasterKey, setMasterKey, getMasterKey } from '@zero-os/secrets'
import { OutputSecretFilter } from '@zero-os/secrets'
import { JsonlLogger, MetricsDB, Tracer } from '@zero-os/observe'
import { MemoryStore, MemoManager, MemoryRetriever } from '@zero-os/memory'
import { RepairEngine } from '@zero-os/supervisor'
import { HeartbeatWriter } from '@zero-os/supervisor'
import { CronScheduler } from '@zero-os/scheduler'
import { globalBus } from './bus'
import type { Channel } from '@zero-os/channel'
import { WebChannel, FeishuChannel, TelegramChannel } from '@zero-os/channel'
import type { Notification } from '@zero-os/shared'

const ZERO_DIR = join(process.cwd(), '.zero')

export interface ZeroOS {
  config: ReturnType<typeof loadConfig>
  vault: Vault
  secretFilter: OutputSecretFilter
  logger: JsonlLogger
  metrics: MetricsDB
  modelRouter: ModelRouter
  toolRegistry: ToolRegistry
  sessionManager: SessionManager
  memoryStore: MemoryStore
  memoManager: MemoManager
  tracer: Tracer
  repairEngine: RepairEngine
  bus: typeof globalBus
  channels: Map<string, Channel>
  notifications: Notification[]
  addNotification(n: Omit<Notification, 'id' | 'createdAt'>): Notification
}

/**
 * Initialize and start ZeRo OS.
 */
export async function startZeroOS(): Promise<ZeroOS> {
  console.log('[ZeRo OS] Starting...')

  // 1. Ensure .zero/ directory structure exists
  ensureDirectories()

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

  // 6. Initialize logger and metrics
  const logsDir = join(ZERO_DIR, 'logs')
  const logger = new JsonlLogger(logsDir)
  const metrics = new MetricsDB(join(logsDir, 'metrics.db'))
  const tracer = new Tracer()
  console.log('[ZeRo OS] Logging initialized')

  // 7. Initialize Model Router
  const secrets = new Map(vault.entries())
  const modelRouter = new ModelRouter(config, secrets)
  const initResult = modelRouter.init()
  console.log(`[ZeRo OS] Model Router: ${initResult.message}`)

  // 8. Initialize Tools
  const fuseRules = loadFuseList(join(ZERO_DIR, 'fuse_list.yaml'))
  const browserMutex = new Mutex()
  const toolRegistry = new ToolRegistry()
  toolRegistry.register(new ReadTool())
  toolRegistry.register(new WriteTool())
  toolRegistry.register(new EditTool())
  toolRegistry.register(new BashTool(fuseRules))
  toolRegistry.register(new BrowserTool(browserMutex))
  toolRegistry.register(new TaskTool(modelRouter, toolRegistry))
  console.log(`[ZeRo OS] ${toolRegistry.list().length} tools registered`)

  // 9. Memory
  const memoryDir = join(ZERO_DIR, 'memory')
  const memoryStore = new MemoryStore(memoryDir)
  const memoManager = new MemoManager(join(memoryDir, 'memo.md'))
  const memoryRetriever = new MemoryRetriever(memoryStore)

  // 9.5 Load identity for context engineering
  const globalPref = memoryStore.list('preference').find(m => m.id === 'pref_global')
  const globalIdentity = globalPref?.content ?? ''
  const agentPref = memoryStore.list('preference').find(m => m.tags?.includes('agent'))
  const agentIdentity = agentPref?.content ?? ''

  // 10. Session Manager — pass observability deps, memory, bus, secret filter, identity, memo
  const sessionManager = new SessionManager(modelRouter, toolRegistry, {
    logger,
    metrics,
    tracer,
    secretFilter,
    memoryRetriever,
    globalIdentity,
    agentIdentity,
    memoReader: () => memoManager.read(),
    bus: globalBus,
  })

  // 11. Repair Engine
  const repairEngine = new RepairEngine()

  // 12. Heartbeat Writer
  const heartbeat = new HeartbeatWriter(join(ZERO_DIR, 'heartbeat.json'))
  heartbeat.start()
  console.log('[ZeRo OS] Heartbeat writer started')

  // 13. Scheduler
  const scheduler = new CronScheduler()
  scheduler.setTriggerHandler(async (schedConfig) => {
    const session = sessionManager.create('scheduler')
    session.initAgent({
      name: `schedule-${schedConfig.name}`,
      systemPrompt: schedConfig.instruction,
    })
    await session.handleMessage(schedConfig.instruction)
  })
  for (const s of config.schedules) {
    scheduler.add(s)
  }
  scheduler.start()
  console.log(`[ZeRo OS] Scheduler started (${config.schedules.length} schedules)`)

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
    appendFileSync(notificationsPath, JSON.stringify(notification) + '\n')
    // Emit to bus so WS clients receive it
    globalBus.emit('notification', {
      notification,
      event: 'notification:new',
    })
    // Push to all connected channels
    for (const [, ch] of channels) {
      if (ch.isConnected() && ch.type !== 'web') {
        ch.send('broadcast', `[notification]${notification.title}: ${notification.description}`).catch(() => {})
      }
    }
    return notification
  }

  // 15. Channel registry
  const channels = new Map<string, Channel>()

  // Web channel — always registered
  const webChannel = new WebChannel()
  await webChannel.start()
  channels.set('web', webChannel)

  // Feishu channel — register if credentials exist
  const feishuAppId = vault.get('feishu_app_id')
  const feishuAppSecret = vault.get('feishu_app_secret')
  if (feishuAppId && feishuAppSecret) {
    const feishuChannel = new FeishuChannel({
      appId: feishuAppId,
      appSecret: feishuAppSecret,
      encryptKey: vault.get('feishu_encrypt_key') ?? undefined,
      verificationToken: vault.get('feishu_verification_token') ?? undefined,
    })
    feishuChannel.setMessageHandler(async (msg) => {
      const chatId = (msg.metadata?.chatId as string) ?? msg.senderId
      const messageId = msg.metadata?.messageId as string
      try {
        const { session, isNew } = sessionManager.getOrCreateForChannel('feishu', chatId)
        if (isNew) {
          session.initAgent({
            name: 'zero-feishu',
            systemPrompt: 'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
          })
        }
        const replies = await session.handleMessage(msg.content)
        const replyText = replies
          .filter((m) => m.role === 'assistant')
          .flatMap((m) => m.content)
          .filter((b) => b.type === 'text')
          .map((b) => (b as { type: 'text'; text: string }).text)
          .join('\n')
        if (replyText && messageId) {
          await feishuChannel.reply(messageId, replyText)
        } else if (replyText) {
          await feishuChannel.send(chatId, replyText)
        }
      } catch (err) {
        console.error('[ZeRo OS] Feishu message handler error:', err)
        try {
          if (messageId) {
            await feishuChannel.reply(messageId, 'An error occurred processing your message.')
          } else {
            await feishuChannel.send(chatId, 'An error occurred processing your message.')
          }
        } catch {}
      }
    })
    await feishuChannel.start()
    channels.set('feishu', feishuChannel)
    console.log('[ZeRo OS] Feishu channel started')
  } else {
    // Register offline placeholder
    const offlineFeishu = new FeishuChannel({ appId: '', appSecret: '' })
    channels.set('feishu', offlineFeishu)
  }

  // Telegram channel — register if credentials exist
  const telegramToken = vault.get('telegram_bot_token')
  if (telegramToken) {
    const telegramChannel = new TelegramChannel({ botToken: telegramToken })
    telegramChannel.setMessageHandler(async (msg) => {
      const chatId = (msg.metadata?.chatId as string) ?? msg.senderId
      const { session, isNew } = sessionManager.getOrCreateForChannel('telegram', chatId)
      if (isNew) {
        session.initAgent({
          name: 'zero-telegram',
          systemPrompt: 'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
        })
      }
      const replies = await session.handleMessage(msg.content)
      const replyText = replies
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.content)
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n')
      await telegramChannel.send(chatId, replyText)
    })
    await telegramChannel.start()
    channels.set('telegram', telegramChannel)
    console.log('[ZeRo OS] Telegram channel started')
  } else {
    // Register offline placeholder
    const offlineTelegram = new TelegramChannel({ botToken: '' })
    channels.set('telegram', offlineTelegram)
  }

  console.log(`[ZeRo OS] ${channels.size} channels registered`)

  // 16. Event bus — wildcard logging
  globalBus.on('*', (payload) => {
    logger.log('info', payload.topic, payload.data)
  })

  // Record repair attempts to MetricsDB
  globalBus.on('repair:end', (payload) => {
    metrics.recordRepair({
      sessionId: payload.data.sessionId as string | undefined,
      status: (payload.data.status as string) === 'success' ? 'success' : 'failed',
      diagnosis: (payload.data.diagnosis as string) ?? '',
      action: (payload.data.action as string) ?? '',
      result: (payload.data.result as string) ?? '',
    })
  })

  // Record tool call metrics from bus events
  globalBus.on('tool:call', (payload) => {
    metrics.recordOperation({
      sessionId: (payload.data.sessionId as string) ?? '',
      tool: (payload.data.tool as string) ?? '',
      event: 'tool:call',
      success: true,
      durationMs: 0,
      createdAt: payload.timestamp,
    })
  })

  console.log('[ZeRo OS] System ready.')

  globalBus.emit('session:create', { event: 'system_start' })

  return {
    config,
    vault,
    secretFilter,
    logger,
    metrics,
    modelRouter,
    toolRegistry,
    sessionManager,
    memoryStore,
    memoManager,
    tracer,
    repairEngine,
    bus: globalBus,
    channels,
    notifications,
    addNotification,
  }
}

function ensureDirectories(): void {
  const dirs = [
    ZERO_DIR,
    join(ZERO_DIR, 'channels'),
    join(ZERO_DIR, 'tools'),
    join(ZERO_DIR, 'skills'),
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
