import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelRouter } from '@zero-os/model'
import { JsonlLogger } from '@zero-os/observe'
import type { Message, SystemConfig, ToolContext, ToolResult } from '@zero-os/shared'
import { generateId, now } from '@zero-os/shared'
import { BaseTool } from '../../tool/base'
import { BashTool } from '../../tool/bash'
import { ReadTool } from '../../tool/read'
import { ToolRegistry } from '../../tool/registry'
import { Session } from '../session'

const API_KEY = 'sk-test-placeholder'
const tempDirs: string[] = []

const config: SystemConfig = {
  providers: {
    'openai-codex': {
      apiType: 'openai_chat_completions',
      baseUrl: 'https://example.invalid',
      auth: { type: 'api_key', apiKeyRef: 'openai_codex_api_key' },
      models: {
        'gpt-5.3-codex-medium': {
          modelId: 'gpt-5.3-codex-medium',
          maxContext: 400000,
          maxOutput: 128000,
          capabilities: ['tools', 'vision', 'reasoning'],
          tags: ['powerful', 'coding'],
        },
        'gpt-5.4-medium': {
          modelId: 'gpt-5.4-medium',
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

class ExtraTool extends BaseTool {
  name = 'extra'
  description = 'Extra tool for snapshot tests'
  parameters = { type: 'object', properties: {} }

  protected async execute(_ctx: ToolContext, _input: unknown): Promise<ToolResult> {
    return { success: true, output: 'ok', outputSummary: 'ok' }
  }
}

function createRouter(): ModelRouter {
  const router = new ModelRouter(config, new Map([['openai_codex_api_key', API_KEY]]))
  router.init()
  return router
}

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(new ReadTool())
  registry.register(new BashTool([]))
  return registry
}

function createTempLogger(): JsonlLogger {
  const dir = mkdtempSync(join(tmpdir(), 'zero-snapshot-session-'))
  tempDirs.push(dir)
  return new JsonlLogger(dir)
}

function makeMessage(sessionId: string, role: 'user' | 'assistant', text: string): Message {
  return {
    id: generateId(),
    sessionId,
    role,
    messageType: 'message',
    content: [{ type: 'text', text }],
    createdAt: now(),
  }
}

function installFakeAgent(session: Session): void {
  ;(session as any).agent = {
    run: async (
      _context: unknown,
      userMessage: string,
      _images: unknown,
      onNewMessage?: (message: Message) => void,
    ) => {
      const user = makeMessage(session.data.id, 'user', userMessage)
      const assistant = makeMessage(session.data.id, 'assistant', 'ok')
      onNewMessage?.(user)
      onNewMessage?.(assistant)
      return [user, assistant]
    },
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Session snapshot lifecycle', () => {
  test('first handled message writes a complete session_start snapshot', async () => {
    const logger = createTempLogger()
    const session = new Session('web', createRouter(), createRegistry(), { logger })
    session.initAgent({ name: 'snapshot-agent', agentInstruction: 'Test snapshot prompt' })
    installFakeAgent(session)

    await session.handleMessage('hello')

    const snapshots = logger.readSessionSnapshots(session.data.id)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].trigger).toBe('session_start')
    expect(snapshots[0].model).toBe('openai-codex/gpt-5.3-codex-medium')
    expect(snapshots[0].systemPrompt).toBeTruthy()
    expect(snapshots[0].tools).toEqual(['read', 'bash'])
    expect(snapshots[0].parentSnapshot).toBeUndefined()
  })

  test('tool registry changes write a tools_changed snapshot with parent linkage', async () => {
    const logger = createTempLogger()
    const registry = createRegistry()
    const session = new Session('web', createRouter(), registry, { logger })
    session.initAgent({ name: 'snapshot-agent', agentInstruction: 'Test snapshot prompt' })
    installFakeAgent(session)

    await session.handleMessage('hello')
    registry.register(new ExtraTool())
    installFakeAgent(session)
    await session.handleMessage('hello again')

    const snapshots = logger.readSessionSnapshots(session.data.id)
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1].trigger).toBe('tools_changed')
    expect(snapshots[1].parentSnapshot).toBe(snapshots[0].id)
    expect(snapshots[1].tools).toEqual(['read', 'bash', 'extra'])
    expect(snapshots[1].systemPrompt).toBeTruthy()
  })

  test('prompt-only changes write a context_updated snapshot', async () => {
    const logger = createTempLogger()
    const session = new Session('web', createRouter(), createRegistry(), { logger })
    session.initAgent({ name: 'snapshot-agent', agentInstruction: 'First prompt' })
    installFakeAgent(session)

    await session.handleMessage('hello')

    session.initAgent({ name: 'snapshot-agent', agentInstruction: 'Updated prompt' })
    installFakeAgent(session)
    await session.handleMessage('hello again')

    const snapshots = logger.readSessionSnapshots(session.data.id)
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1].trigger).toBe('context_updated')
    expect(snapshots[1].parentSnapshot).toBe(snapshots[0].id)
    expect(snapshots[1].tools).toEqual(['read', 'bash'])
    expect(snapshots[1].systemPrompt).toBeTruthy()
    expect(snapshots[1].systemPrompt).not.toBe(snapshots[0].systemPrompt)
  })

  test('switchModel writes a complete model_switch snapshot', async () => {
    const logger = createTempLogger()
    const session = new Session('web', createRouter(), createRegistry(), { logger })
    session.initAgent({ name: 'snapshot-agent', agentInstruction: 'Test snapshot prompt' })
    installFakeAgent(session)

    await session.handleMessage('hello')
    const result = await session.switchModel('gpt-5.4-medium')

    expect(result.success).toBe(true)

    const snapshots = logger.readSessionSnapshots(session.data.id)
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1].trigger).toBe('model_switch')
    expect(snapshots[1].parentSnapshot).toBe(snapshots[0].id)
    expect(snapshots[1].model).toBe('openai-codex/gpt-5.4-medium')
    expect(snapshots[1].systemPrompt).toBeTruthy()
  })

  test('restored session reuses the latest complete snapshot state', async () => {
    const logger = createTempLogger()
    const router = createRouter()
    const registry = createRegistry()
    const session = new Session('web', router, registry, { logger })
    session.initAgent({ name: 'snapshot-agent', agentInstruction: 'Test snapshot prompt' })
    installFakeAgent(session)

    await session.handleMessage('hello')
    const existingSnapshotId = logger.readSessionSnapshots(session.data.id)[0]?.id

    const restored = Session.restore(
      session.data,
      session.getMessages(),
      router,
      registry,
      { logger },
      session.getSystemPrompt(),
    )
    restored.initAgent({ name: 'snapshot-agent', agentInstruction: 'Test snapshot prompt' })
    installFakeAgent(restored)

    await restored.handleMessage('follow up')

    const snapshots = logger.readSessionSnapshots(session.data.id)
    expect(snapshots).toHaveLength(1)
    expect((restored as any).currentSnapshotId).toBe(existingSnapshotId)
  })
})
