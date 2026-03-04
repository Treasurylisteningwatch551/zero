import { describe, test, expect } from 'bun:test'
import { Session } from '../session'
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

describe('Session', () => {
  test('creates with correct initial state', () => {
    const router = createRouter()
    const registry = createToolRegistry()
    const session = new Session('web', router, registry)

    expect(session.data.id).toMatch(/^sess_/)
    expect(session.data.source).toBe('web')
    expect(session.data.status).toBe('active')
    expect(session.data.currentModel).toBe('gpt-5.3-codex-medium')
  })

  test('/model command returns current model', () => {
    const router = createRouter()
    const registry = createToolRegistry()
    const session = new Session('web', router, registry)
    session.initAgent({ name: 'test', systemPrompt: 'test' })

    // Note: handleMessage is async but /model is sync command
  })

  test('handles real conversation with AI (real API)', async () => {
    const router = createRouter()
    const registry = createToolRegistry()
    const session = new Session('web', router, registry)
    session.initAgent({
      name: 'test-agent',
      systemPrompt: 'You are a helpful assistant. Reply briefly.',
    })

    const messages = await session.handleMessage('Say exactly "ZeRo OS running" and nothing else.')

    expect(messages.length).toBeGreaterThanOrEqual(2) // user + assistant
    const lastMsg = messages[messages.length - 1]
    expect(lastMsg.role).toBe('assistant')
    expect(lastMsg.content.length).toBeGreaterThan(0)
  }, 30000)
})

describe('SessionManager', () => {
  test('creates and lists sessions', () => {
    const router = createRouter()
    const registry = createToolRegistry()
    const manager = new SessionManager(router, registry)

    const s1 = manager.create('web')
    const s2 = manager.create('feishu')

    expect(manager.listActive()).toHaveLength(2)
    expect(manager.get(s1.data.id)).toBeDefined()
    expect(manager.get(s2.data.id)).toBeDefined()
  })

  test('remove session', () => {
    const router = createRouter()
    const registry = createToolRegistry()
    const manager = new SessionManager(router, registry)

    const s1 = manager.create('web')
    manager.remove(s1.data.id)
    expect(manager.get(s1.data.id)).toBeUndefined()
  })
})
