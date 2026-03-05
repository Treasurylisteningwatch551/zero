import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, loadFuseList } from '@zero-os/core'
import { ModelRouter } from '@zero-os/model'
import { ToolRegistry, ReadTool, WriteTool, EditTool, BashTool, FetchTool, TaskTool, MemoryTool } from '@zero-os/core'
import { SessionManager } from '@zero-os/core'
import { Vault, generateMasterKey, setMasterKey, getMasterKey } from '@zero-os/secrets'
import { OutputSecretFilter } from '@zero-os/secrets'
import { JsonlLogger, MetricsDB, Tracer, SessionDB } from '@zero-os/observe'
import { MemoryStore, MemoManager, MemoryRetriever } from '@zero-os/memory'
import { RepairEngine } from '@zero-os/supervisor'
import { HeartbeatWriter } from '@zero-os/supervisor'
import { CronScheduler } from '@zero-os/scheduler'
import { globalBus } from './bus'
import { createTelegramStreamFlusher, reconcileTelegramFinalText } from './telegram-streaming'
import { canRunTelegramRestart, syncTelegramCommandMenu } from './telegram-menu'
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
  sessionDb: SessionDB
  modelRouter: ModelRouter
  toolRegistry: ToolRegistry
  sessionManager: SessionManager
  memoryStore: MemoryStore
  memoManager: MemoManager
  tracer: Tracer
  repairEngine: RepairEngine
  heartbeat: HeartbeatWriter
  scheduler: CronScheduler
  bus: typeof globalBus
  channels: Map<string, Channel>
  notifications: Notification[]
  addNotification(n: Omit<Notification, 'id' | 'createdAt'>): Notification
  shutdown(): Promise<void>
}

/**
 * Initialize and start ZeRo OS.
 */
export async function startZeroOS(): Promise<ZeroOS> {
  const startedAt = Date.now()
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

  // 6. Initialize logger, metrics, and session DB
  const logsDir = join(ZERO_DIR, 'logs')
  const logger = new JsonlLogger(logsDir)
  const metrics = new MetricsDB(join(logsDir, 'metrics.db'))
  const sessionDb = new SessionDB(join(logsDir, 'sessions.db'))
  const tracer = new Tracer()
  console.log('[ZeRo OS] Logging initialized')

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
  toolRegistry.register(new MemoryTool())
  toolRegistry.register(new TaskTool(modelRouter, toolRegistry))
  console.log(`[ZeRo OS] ${toolRegistry.list().length} tools registered`)

  // 9. Memory
  const memoryDir = join(ZERO_DIR, 'memory')
  const memoryStore = new MemoryStore(memoryDir)
  const memoManager = new MemoManager(join(memoryDir, 'memo.md'))
  const memoryRetriever = new MemoryRetriever(memoryStore)

  // 9.5 Identity reader — hot-reloads identity on each turn per agent name
  const identityReader = (agentName: string) => {
    const globalPref = memoryStore.list('preference').find(m => m.id === 'pref_global')
    return {
      global: globalPref?.content ?? '',
      agent: memoryStore.getAgentPreference(agentName),
    }
  }

  // 10. Session Manager — pass observability deps, memory, bus, secret filter, identity, memo
  const secretResolver = (ref: string) => vault.get(ref) ?? undefined
  const sessionManager = new SessionManager(modelRouter, toolRegistry, {
    logger,
    metrics,
    tracer,
    secretFilter,
    secretResolver,
    memoryRetriever,
    memoryStore,
    identityReader,
    memoReader: () => memoManager.read(),
    bus: globalBus,
    sessionDb,
  }, sessionDb)

  // 10.5. Restore active sessions from DB
  const restoredCount = sessionManager.restoreFromDB()
  if (restoredCount > 0) {
    console.log(`[ZeRo OS] Restored ${restoredCount} sessions from DB`)
  }

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

  function buildNewSessionReply(
    currentModel: string,
    modelResult?: { success: boolean; message: string }
  ): string {
    if (!modelResult) {
      return 'New conversation started.'
    }
    if (modelResult.success) {
      return `New conversation started with model: ${currentModel}`
    }
    return `New conversation started. ${modelResult.message}`
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
      let activeSessionId: string | null = null
      let typingReactionId: string | null = null
      try {
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
          const modelResult = newCommand.modelArg
            ? modelRouter.switchModel(newCommand.modelArg)
            : undefined
          const { session } = sessionManager.startNewForChannel('feishu', chatId)
          activeSessionId = session.data.id
          session.initAgent({
            name: 'zero-feishu',
            systemPrompt: 'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
          })

          const replyText = buildNewSessionReply(session.data.currentModel, modelResult)
          if (messageId) {
            await feishuChannel.reply(messageId, replyText)
          } else {
            await feishuChannel.send(chatId, replyText)
          }
          return
        }

        const { session, isNew } = sessionManager.getOrCreateForChannel('feishu', chatId)
        activeSessionId = session.data.id
        if (isNew) {
          session.initAgent({
            name: 'zero-feishu',
            systemPrompt: 'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
          })
        }

        // Add typing reaction before processing
        typingReactionId = messageId
          ? await feishuChannel.react(messageId, 'Typing')
          : null

        // Progressive messaging: send each assistant text to IM as it arrives
        let firstReply = true
        let lastSentMsgId: string | null = null
        let lastProgressText: string | null = null

        const replies = await session.handleMessage(msg.content, {
          images: msg.images,
          onProgress: (newMsg) => {
            const text = extractAssistantText(newMsg)
            if (!text) return
            if (lastProgressText === text) return

            lastProgressText = text
            lastSentMsgId = newMsg.id

            if (firstReply && messageId) {
              firstReply = false
              feishuChannel.reply(messageId, text).catch((err) =>
                console.error('[ZeRo OS] Feishu progressive send error:', err))
            } else {
              feishuChannel.send(chatId, text).catch((err) =>
                console.error('[ZeRo OS] Feishu progressive send error:', err))
            }
          },
        })

        // Fallback: if onProgress sent nothing (e.g. command response), use old path
        if (!lastSentMsgId) {
          const replyText = collectAssistantReply(replies)
          if (replyText && messageId) {
            await feishuChannel.reply(messageId, replyText)
          } else if (replyText) {
            await feishuChannel.send(chatId, replyText)
          }
        }

        // Success: remove typing, add done reaction
        if (messageId) {
          if (typingReactionId) feishuChannel.removeReaction(messageId, typingReactionId).catch(() => {})
          feishuChannel.react(messageId, 'DONE').catch(() => {})
        }
      } catch (err) {
        console.error('[ZeRo OS] Feishu message handler error:', err)
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
          console.warn('[ZeRo OS] Archived poisoned Feishu session after tool output mismatch:', activeSessionId)
        }
        const userReply = sessionWasArchived
          ? 'Session corrupted and has been reset. Please resend your message.'
          : 'An error occurred processing your message.'
        try {
          if (messageId) {
            if (typingReactionId) feishuChannel.removeReaction(messageId, typingReactionId).catch(() => {})
            await feishuChannel.reply(messageId, userReply)
          } else {
            await feishuChannel.send(chatId, userReply)
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
      const messageId = msg.metadata?.messageId as number | undefined
      const chatType = msg.metadata?.chatType
      let activeSessionId: string | null = null
      try {
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

          const reply = 'Restarting ZeRo OS...'
          if (messageId) {
            await telegramChannel.replyRich(chatId, messageId, reply)
          } else {
            await telegramChannel.sendRich(chatId, reply)
          }
          setTimeout(() => shutdown(), 500)
          return
        }

        const newCommand = parseNewSessionCommand(msg.content)
        if (newCommand) {
          const modelResult = newCommand.modelArg
            ? modelRouter.switchModel(newCommand.modelArg)
            : undefined
          const { session } = sessionManager.startNewForChannel('telegram', chatId)
          activeSessionId = session.data.id
          session.initAgent({
            name: 'zero-telegram',
            systemPrompt: 'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
          })
          const replyText = buildNewSessionReply(session.data.currentModel, modelResult)
          if (messageId) {
            await telegramChannel.replyRich(chatId, messageId, replyText)
          } else {
            await telegramChannel.sendRich(chatId, replyText)
          }
          return
        }

        // Quick ACK to improve UX before long-running processing starts.
        telegramChannel.sendTyping(chatId).catch(() => {})
        if (messageId) {
          telegramChannel.react(chatId, messageId, '👀').catch(() => {})
        }

        const { session, isNew } = sessionManager.getOrCreateForChannel('telegram', chatId)
        activeSessionId = session.data.id
        if (isNew) {
          session.initAgent({
            name: 'zero-telegram',
            systemPrompt: 'You are ZeRo OS, an AI agent system. Be helpful, concise, and accurate.',
          })
        }

        // Telegram streaming UX: first message + editMessageText at 350ms cadence.
        let streamText = ''
        let seenDelta = false
        let lastTurnId: string | null = null

        const minIntervalMs = 350
        const streamFlusher = createTelegramStreamFlusher({
          minIntervalMs,
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
            streamFlusher.flush(false).catch((err) =>
              console.error('[ZeRo OS] Telegram streaming flush error:', err))
          },
          onProgress: (newMsg) => {
            const text = extractAssistantText(newMsg)
            if (!text) return
            if (!seenDelta) {
              streamText = streamText ? `${streamText}\n${text}` : text
            }
          },
        })

        const finalReply = collectAssistantReply(replies)
        streamText = reconcileTelegramFinalText(streamText, finalReply)

        if (streamText) {
          try {
            await streamFlusher.flush(true)
          } catch (err) {
            console.error('[ZeRo OS] Telegram final flush failed, fallback to sendRich:', {
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

        // Success: replace 👀 with ✅
        if (messageId) {
          telegramChannel.react(chatId, messageId, '✅').catch(() => {})
        }
      } catch (err) {
        console.error('[ZeRo OS] Telegram message handler error:', err)
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
          console.warn('[ZeRo OS] Archived poisoned Telegram session after tool output mismatch:', activeSessionId)
        }
        const userReply = sessionWasArchived
          ? 'Session corrupted and has been reset. Please resend your message.'
          : 'An error occurred processing your message.'
        // Error: replace 👀 with ❌
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
      console.log('[ZeRo OS] Telegram commands/menu synced')
    } catch (err) {
      console.warn('[ZeRo OS] Telegram commands/menu sync failed:', err)
    }

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

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('\n[ZeRo OS] Shutting down...')
    scheduler.stop()
    console.log('[ZeRo OS] Scheduler stopped')
    heartbeat.stop()
    console.log('[ZeRo OS] Heartbeat stopped')
    for (const [, ch] of channels) {
      try { await ch.stop() } catch {}
    }
    console.log('[ZeRo OS] Channels closed')
    sessionManager.flushAll()
    console.log('[ZeRo OS] Sessions flushed to DB')
    sessionDb.close()
    console.log('[ZeRo OS] Session DB closed')
    metrics.close()
    console.log('[ZeRo OS] Metrics DB closed')
    console.log('[ZeRo OS] Shutdown complete.')
    process.exit(0)
  }

  return {
    config,
    vault,
    secretFilter,
    logger,
    metrics,
    sessionDb,
    modelRouter,
    toolRegistry,
    sessionManager,
    memoryStore,
    memoManager,
    tracer,
    repairEngine,
    heartbeat,
    scheduler,
    bus: globalBus,
    channels,
    notifications,
    addNotification,
    shutdown,
  }
}

function ensureDirectories(): void {
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
