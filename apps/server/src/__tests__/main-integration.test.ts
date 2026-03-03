import { describe, test, expect, beforeAll } from 'bun:test'
import { startZeroOS } from '../main'
import type { ZeroOS } from '../main'

let zero: ZeroOS

beforeAll(async () => {
  zero = await startZeroOS()
})

describe('startZeroOS Integration', () => {
  test('returns all required components', () => {
    expect(zero.config).toBeDefined()
    expect(zero.vault).toBeDefined()
    expect(zero.secretFilter).toBeDefined()
    expect(zero.logger).toBeDefined()
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
    expect(current!.modelName).toBe('gpt-5.3-codex-medium')
  })

  test('toolRegistry has 6 registered tools', () => {
    const tools = zero.toolRegistry.list()
    expect(tools.length).toBe(6)
    const names = tools.map((t) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('write')
    expect(names).toContain('edit')
    expect(names).toContain('bash')
    expect(names).toContain('browser')
    expect(names).toContain('task')
  })

  test('channels map contains web, feishu, telegram', () => {
    expect(zero.channels.has('web')).toBe(true)
    expect(zero.channels.has('feishu')).toBe(true)
    expect(zero.channels.has('telegram')).toBe(true)
    // Web should be connected
    const webChannel = zero.channels.get('web')!
    expect(webChannel.isConnected()).toBe(true)
  })

  test('bus can emit events without error', () => {
    expect(() => {
      zero.bus.emit('test:event', { key: 'value' })
    }).not.toThrow()
  })
})
