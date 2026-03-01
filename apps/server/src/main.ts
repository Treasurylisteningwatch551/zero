import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, loadFuseList } from '@zero-os/core'
import { ModelRouter } from '@zero-os/model'
import { ToolRegistry, ReadTool, WriteTool, EditTool, BashTool, BrowserTool, TaskTool } from '@zero-os/core'
import { Mutex } from '@zero-os/shared'
import { SessionManager } from '@zero-os/core'
import { Vault, generateMasterKey, setMasterKey, getMasterKey } from '@zero-os/secrets'
import { OutputSecretFilter } from '@zero-os/secrets'
import { JsonlLogger, MetricsDB, Tracer } from '@zero-os/observe'
import { MemoryStore, MemoManager } from '@zero-os/memory'
import { RepairEngine } from '@zero-os/supervisor'
import { globalBus } from './bus'

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

  // 9. Session Manager
  const sessionManager = new SessionManager(modelRouter, toolRegistry)

  // 10. Memory
  const memoryDir = join(ZERO_DIR, 'memory')
  const memoryStore = new MemoryStore(memoryDir)
  const memoManager = new MemoManager(join(memoryDir, 'memo.md'))

  // 11. Repair Engine
  const repairEngine = new RepairEngine()

  // 12. Event bus
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
