import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startZeroOS } from '../main'
import type { ZeroOS } from '../main'

let zero: ZeroOS
let testDataDir: string

beforeAll(async () => {
  testDataDir = mkdtempSync(join(tmpdir(), 'zero-test-'))
  process.env.ZERO_MASTER_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64')
  writeFileSync(
    join(testDataDir, 'config.yaml'),
    `providers:
  openai-codex:
    api_type: openai_chat_completions
    base_url: https://example.com/v1
    auth:
      type: api_key
      api_key_ref: openai_codex_api_key
    models:
      gpt-5.4-medium:
        model_id: gpt-5.4-medium
        max_context: 400000
        max_output: 128000
        capabilities:
          - tools
          - vision
          - reasoning
        tags:
          - powerful
          - coding
default_model: openai-codex/gpt-5.4-medium
fallback_chain:
  - openai-codex/gpt-5.4-medium
schedules: []
fuse_list: []
`,
  )
  writeFileSync(join(testDataDir, 'fuse_list.yaml'), 'rules: []\n')
  zero = await startZeroOS({ dataDir: testDataDir, skipProcessExit: true })
})

afterAll(async () => {
  await zero.shutdown()
  delete process.env.ZERO_MASTER_KEY_BASE64
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

  test('toolRegistry has 15 registered tools', () => {
    const tools = zero.toolRegistry.list()
    expect(tools.length).toBe(15)
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
    expect(names).toContain('spawn_agent')
    expect(names).toContain('wait_agent')
    expect(names).toContain('close_agent')
    expect(names).toContain('send_input')
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
