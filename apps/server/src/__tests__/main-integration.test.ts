import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startZeroOS } from '../main'
import type { ZeroOS } from '../main'

let zero: ZeroOS
let testDataDir: string

beforeAll(async () => {
  testDataDir = mkdtempSync(join(tmpdir(), 'zero-test-'))
  const prodDir = join(process.cwd(), '.zero')
  // Copy only config files needed for bootstrap (not databases)
  for (const file of ['secrets.enc', 'config.yaml', 'fuse_list.yaml']) {
    const src = join(prodDir, file)
    if (existsSync(src)) {
      cpSync(src, join(testDataDir, file))
    }
  }
  zero = await startZeroOS({ dataDir: testDataDir, skipProcessExit: true })
})

afterAll(async () => {
  await zero.shutdown()
  rmSync(testDataDir, { recursive: true, force: true })
})

describe('startZeroOS Integration', () => {
  test('runs core-ready hook before external channels start', async () => {
    const observed = {
      webRegistered: false,
      externalChannelsRegistered: false,
    }

    const hookedZero = await startZeroOS({
      dataDir: testDataDir,
      skipProcessExit: true,
      onCoreReady: (runtime) => {
        observed.webRegistered = runtime.channels.has('web')
        observed.externalChannelsRegistered = runtime.channels.size > 1
      },
    })

    expect(observed.webRegistered).toBe(true)
    expect(observed.externalChannelsRegistered).toBe(false)

    await hookedZero.shutdown()
  })

  test('returns all required components', () => {
    expect(zero.config).toBeDefined()
    expect(zero.vault).toBeDefined()
    expect(zero.secretFilter).toBeDefined()
    expect(zero.observability).toBeDefined()
    expect(zero.metrics).toBeDefined()
    expect(zero.modelRouter).toBeDefined()
    expect(zero.toolRegistry).toBeDefined()
    expect(zero.sessionManager).toBeDefined()
    expect(zero.memoryStore).toBeDefined()
    expect(zero.memoManager).toBeDefined()
    expect(zero.tracer).toBeDefined()
    expect(zero.repairEngine).toBeDefined()
    expect(zero.bus).toBeDefined()
    expect(zero.channels).toBeDefined()
    expect(zero.notifications).toBeDefined()
    expect(typeof zero.addNotification).toBe('function')
  })

  test('modelRouter has initialized adapters', () => {
    const current = zero.modelRouter.getCurrentModel()
    expect(current).toBeDefined()
    if (!current) {
      throw new Error('expected current model')
    }
    expect(current.modelName).toBe('gpt-5.4-medium')
  })

  test('toolRegistry has 11 registered tools', () => {
    const tools = zero.toolRegistry.list()
    expect(tools.length).toBe(11)
    const names = tools.map((t) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('write')
    expect(names).toContain('edit')
    expect(names).toContain('bash')
    expect(names).toContain('fetch')
    expect(names).toContain('memory_search')
    expect(names).toContain('memory_get')
    expect(names).toContain('memory')
    expect(names).toContain('task')
    expect(names).toContain('schedule')
    expect(names).toContain('codex')
  })

  test('channels map contains web, feishu, telegram', () => {
    expect(zero.channels.has('web')).toBe(true)
    expect(zero.channels.has('feishu')).toBe(true)
    expect(zero.channels.has('telegram')).toBe(true)
    // Web should be connected
    const webChannel = zero.channels.get('web')
    if (!webChannel) {
      throw new Error('expected web channel')
    }
    expect(webChannel.isConnected()).toBe(true)
  })

  test('bus can emit events without error', () => {
    expect(() => {
      zero.bus.emit('heartbeat', { key: 'value' })
    }).not.toThrow()
  })
})
