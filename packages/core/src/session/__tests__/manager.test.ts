import { describe, test, expect } from 'bun:test'
import { SessionManager } from '../manager'
import { ModelRouter } from '@zero-os/model'
import { ToolRegistry } from '../../tool/registry'
import { ReadTool } from '../../tool/read'
import { BashTool } from '../../tool/bash'
import type { SystemConfig } from '@zero-os/shared'

const API_KEY = 'sk-c6c02cbd0c25473f97f9be0da6070f6d'

const config: SystemConfig = {
  providers: {
    'openai-codex': {
      apiType: 'openai_chat_completions',
      baseUrl: 'https://www.right.codes/codex',
      auth: { type: 'api_key', apiKeyRef: 'openai_codex_api_key' },
      models: {
        'gpt-5.3-codex-medium': {
          modelId: 'gpt-5.3-codex-medium',
          maxContext: 400000,
          maxOutput: 128000,
          capabilities: ['tools', 'vision', 'reasoning'],
          tags: ['powerful', 'coding'],
        },
      },
    },
  },
  defaultModel: 'gpt-5.3-codex-medium',
  fallbackChain: ['gpt-5.3-codex-medium'],
  schedules: [],
  fuseList: [],
}

const secrets = new Map([['openai_codex_api_key', API_KEY]])

function createRouter() {
  const router = new ModelRouter(config, secrets)
  router.init()
  return router
}

function createToolRegistry() {
  const registry = new ToolRegistry()
  registry.register(new ReadTool())
  registry.register(new BashTool([]))
  return registry
}

function createManager() {
  return new SessionManager(createRouter(), createToolRegistry())
}

describe('SessionManager', () => {
  test('create assigns unique ID', () => {
    const manager = createManager()
    const s1 = manager.create('web')
    const s2 = manager.create('web')

    expect(s1.data.id).not.toBe(s2.data.id)
    expect(s1.data.id).toMatch(/^sess_/)
    expect(s2.data.id).toMatch(/^sess_/)
  })

  test('listActive returns active/idle sessions', () => {
    const manager = createManager()
    const s1 = manager.create('web')
    const s2 = manager.create('feishu')
    const s3 = manager.create('scheduler')

    // All start as active
    expect(manager.listActive()).toHaveLength(3)

    // Mark one as completed
    s2.setStatus('completed')
    expect(manager.listActive()).toHaveLength(2)

    // Mark one as idle — should still be in listActive
    s1.setStatus('idle')
    expect(manager.listActive()).toHaveLength(2)

    // The remaining active ones should be s1 (idle) and s3 (active)
    const activeIds = manager.listActive().map((s) => s.data.id)
    expect(activeIds).toContain(s1.data.id)
    expect(activeIds).toContain(s3.data.id)
    expect(activeIds).not.toContain(s2.data.id)
  })

  test('listAll returns all sessions including completed', () => {
    const manager = createManager()
    const s1 = manager.create('web')
    const s2 = manager.create('feishu')

    s1.setStatus('completed')

    expect(manager.listAll()).toHaveLength(2)
    const allIds = manager.listAll().map((s) => s.data.id)
    expect(allIds).toContain(s1.data.id)
    expect(allIds).toContain(s2.data.id)
  })

  test('get non-existent returns undefined', () => {
    const manager = createManager()
    expect(manager.get('nonexistent-id')).toBeUndefined()
  })

  test('getOrCreateForChannel: new channel creates new session, isNew=true', () => {
    const manager = createManager()
    const result = manager.getOrCreateForChannel('telegram', 'channel-1')

    expect(result.isNew).toBe(true)
    expect(result.session).toBeDefined()
    expect(result.session.data.source).toBe('telegram')
    expect(result.session.data.channelId).toBe('channel-1')
  })

  test('getOrCreateForChannel: same channel reuses session, isNew=false', () => {
    const manager = createManager()
    const first = manager.getOrCreateForChannel('telegram', 'channel-2')
    const second = manager.getOrCreateForChannel('telegram', 'channel-2')

    expect(first.isNew).toBe(true)
    expect(second.isNew).toBe(false)
    expect(second.session.data.id).toBe(first.session.data.id)
  })

  test('getOrCreateForChannel: completed session for same channel creates new, isNew=true', () => {
    const manager = createManager()
    const first = manager.getOrCreateForChannel('web', 'channel-3')
    const firstId = first.session.data.id

    // Mark the session as completed
    first.session.setStatus('completed')

    const second = manager.getOrCreateForChannel('web', 'channel-3')
    expect(second.isNew).toBe(true)
    expect(second.session.data.id).not.toBe(firstId)
  })

  test('startNewForChannel: rotates mapping and completes previous active session', () => {
    const manager = createManager()
    const first = manager.getOrCreateForChannel('feishu', 'channel-rotate')
    const firstId = first.session.data.id

    const rotated = manager.startNewForChannel('feishu', 'channel-rotate')
    const secondId = rotated.session.data.id

    expect(rotated.previousSessionId).toBe(firstId)
    expect(secondId).not.toBe(firstId)
    expect(rotated.session.data.source).toBe('feishu')
    expect(rotated.session.data.channelId).toBe('channel-rotate')
    expect(manager.get(firstId)?.getStatus()).toBe('completed')

    const current = manager.getOrCreateForChannel('feishu', 'channel-rotate')
    expect(current.isNew).toBe(false)
    expect(current.session.data.id).toBe(secondId)
  })

  test('startNewForChannel: supports archiving previous session', () => {
    const manager = createManager()
    const first = manager.getOrCreateForChannel('telegram', 'channel-archive')
    const firstId = first.session.data.id

    const rotated = manager.startNewForChannel('telegram', 'channel-archive', {
      previousStatus: 'archived',
    })

    expect(rotated.previousSessionId).toBe(firstId)
    expect(manager.get(firstId)?.getStatus()).toBe('archived')
    expect(rotated.session.data.id).not.toBe(firstId)
  })

  test('remove cleans up channel mapping', () => {
    const manager = createManager()
    const { session } = manager.getOrCreateForChannel('feishu', 'channel-4')
    const sessionId = session.data.id

    // Verify session exists
    expect(manager.get(sessionId)).toBeDefined()

    // Remove the session
    manager.remove(sessionId)

    // Session should be gone
    expect(manager.get(sessionId)).toBeUndefined()

    // Getting the same channel should create a new session
    const result = manager.getOrCreateForChannel('feishu', 'channel-4')
    expect(result.isNew).toBe(true)
    expect(result.session.data.id).not.toBe(sessionId)
  })
})
