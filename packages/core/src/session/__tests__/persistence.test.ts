import { describe, test, expect, afterAll } from 'bun:test'
import { SessionDB } from '@zero-os/observe'
import { Session } from '../session'
import { SessionManager } from '../manager'
import { ModelRouter } from '@zero-os/model'
import { ToolRegistry } from '../../tool/registry'
import { loadConfig } from '../../config/loader'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Session as SessionData, Message } from '@zero-os/shared'

const testDir = join(import.meta.dir, '__fixtures__')
const dbPath = join(testDir, 'test-persistence.db')

const config = loadConfig(join(process.cwd(), '.zero', 'config.yaml'))
const secrets = new Map<string, string>([
  ['openai_codex_api_key', 'sk-test-placeholder'],
])

describe('Session Persistence', () => {
  let sessionDb: SessionDB
  let modelRouter: ModelRouter
  let toolRegistry: ToolRegistry

  afterAll(() => {
    sessionDb?.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  test('setup', () => {
    mkdirSync(testDir, { recursive: true })
    sessionDb = new SessionDB(dbPath)
    modelRouter = new ModelRouter(config, secrets)
    modelRouter.init()
    toolRegistry = new ToolRegistry()
  })

  test('Session constructor persists to DB when sessionDb provided', () => {
    const session = new Session('web', modelRouter, toolRegistry, { sessionDb })
    const row = sessionDb.getSession(session.data.id)
    expect(row).not.toBeNull()
    expect(row!.id).toBe(session.data.id)
    expect(row!.source).toBe('web')
    expect(row!.status).toBe('active')
  })

  test('setStatus persists status change', () => {
    const session = new Session('web', modelRouter, toolRegistry, { sessionDb })
    session.setStatus('completed')

    const row = sessionDb.getSession(session.data.id)!
    expect(row.status).toBe('completed')
  })

  test('initAgent persists agent config', () => {
    const session = new Session('web', modelRouter, toolRegistry, { sessionDb })
    session.initAgent({ name: 'test-agent', systemPrompt: 'You are a test.' })

    const row = sessionDb.getSession(session.data.id)!
    expect(row.agentConfigJson).toBeDefined()
    const config = JSON.parse(row.agentConfigJson!)
    expect(config.name).toBe('test-agent')
    expect(config.systemPrompt).toBe('You are a test.')
  })

  test('Session.restore creates session with correct data and messages', () => {
    const data: SessionData = {
      id: 'sess_restore_test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'feishu',
      status: 'active',
      currentModel: 'gpt-5.3-codex-medium',
      modelHistory: [{ model: 'gpt-5.3-codex-medium', from: new Date().toISOString(), to: null }],
      tags: ['restored'],
      channelName: 'feishu:ops',
      channelId: 'chat_123',
    }

    const messages: Message[] = [
      {
        id: 'msg_1',
        sessionId: 'sess_restore_test',
        role: 'user',
        messageType: 'message',
        content: [{ type: 'text', text: 'Hello' }],
        createdAt: new Date().toISOString(),
      },
      {
        id: 'msg_2',
        sessionId: 'sess_restore_test',
        role: 'assistant',
        messageType: 'message',
        content: [{ type: 'text', text: 'Hi there!' }],
        createdAt: new Date().toISOString(),
      },
    ]

    const session = Session.restore(data, messages, modelRouter, toolRegistry)
    expect(session.data.id).toBe('sess_restore_test')
    expect(session.data.source).toBe('feishu')
    expect(session.data.channelName).toBe('feishu:ops')
    expect(session.data.channelId).toBe('chat_123')
    expect(session.data.tags).toEqual(['restored'])
    expect(session.getStatus()).toBe('active')
    expect(session.getMessages()).toHaveLength(2)
    expect(session.getMessages()[0].content[0]).toEqual({ type: 'text', text: 'Hello' })
    expect(session.getAgentConfig()).toBeNull() // Not initialized yet
  })

  test('SessionManager.restoreFromDB restores sessions and channel mappings', () => {
    // Save sessions directly to DB
    const data1: SessionData = {
      id: 'sess_mgr_1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'feishu',
      status: 'active',
      currentModel: 'gpt-5.3-codex-medium',
      modelHistory: [{ model: 'gpt-5.3-codex-medium', from: new Date().toISOString(), to: null }],
      tags: [],
      channelName: 'feishu:ops',
      channelId: 'chat_feishu_1',
    }
    sessionDb.saveSession(data1, '{"name":"zero-feishu","systemPrompt":"test"}')
    sessionDb.saveMessages('sess_mgr_1', [
      { id: 'm1', sessionId: 'sess_mgr_1', role: 'user', messageType: 'message',
        content: [{ type: 'text', text: 'Hi' }], createdAt: new Date().toISOString() },
    ])

    const data2: SessionData = {
      id: 'sess_mgr_2',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'web',
      status: 'idle',
      currentModel: 'gpt-5.3-codex-medium',
      modelHistory: [{ model: 'gpt-5.3-codex-medium', from: new Date().toISOString(), to: null }],
      tags: [],
    }
    sessionDb.saveSession(data2)

    // Create a new SessionManager and restore
    const manager = new SessionManager(modelRouter, toolRegistry, { sessionDb }, sessionDb)
    const count = manager.restoreFromDB()

    // Should restore both active and idle sessions from DB
    // (Note: previous test sessions are also in DB, so count may be higher)
    expect(count).toBeGreaterThanOrEqual(2)
    expect(manager.get('sess_mgr_1')).toBeDefined()
    expect(manager.get('sess_mgr_2')).toBeDefined()

    // Verify messages restored
    expect(manager.get('sess_mgr_1')!.getMessages()).toHaveLength(1)

    // Verify channel mapping restored
    const { session, isNew } = manager.getOrCreateForChannel('feishu', 'chat_feishu_1', 'feishu:ops')
    expect(isNew).toBe(false)
    expect(session.data.id).toBe('sess_mgr_1')
  })

  test('SessionManager.flushAll saves all sessions to DB', () => {
    const manager = new SessionManager(modelRouter, toolRegistry, { sessionDb }, sessionDb)

    // Create sessions via manager
    const s1 = manager.create('web')
    const s2 = manager.create('telegram')
    s2.data.channelId = 'tg_flush'

    // Flush all to DB
    manager.flushAll()

    // Verify they're in the DB
    const row1 = sessionDb.getSession(s1.data.id)
    const row2 = sessionDb.getSession(s2.data.id)
    expect(row1).not.toBeNull()
    expect(row2).not.toBeNull()
    expect(row2!.channelId).toBe('tg_flush')
  })

  test('SessionManager DB query proxies work', () => {
    const manager = new SessionManager(modelRouter, toolRegistry, { sessionDb }, sessionDb)

    // getFromDB
    const row = manager.getFromDB('sess_roundtrip') // from session-db test earlier — may not exist
    // Just verify the proxy doesn't throw
    expect(row === null || row?.id === 'sess_roundtrip').toBe(true)

    // listAllFromDB
    const all = manager.listAllFromDB()
    expect(all.length).toBeGreaterThan(0)

    // listAllFromDB with filter
    const completed = manager.listAllFromDB({ status: 'completed' })
    expect(completed.every((r) => r.status === 'completed')).toBe(true)
  })
})
