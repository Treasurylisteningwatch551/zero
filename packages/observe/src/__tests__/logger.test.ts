import { describe, test, expect, afterAll } from 'bun:test'
import { JsonlLogger } from '../logger'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const testDir = join(import.meta.dir, '__fixtures__/logs')

describe('JsonlLogger', () => {
  afterAll(() => {
    rmSync(join(import.meta.dir, '__fixtures__'), { recursive: true, force: true })
  })

  test('log writes to operations.jsonl', () => {
    const logger = new JsonlLogger(testDir)
    logger.log('info', 'test_event', { key: 'value' })

    const entries = logger.readEntries('operations.jsonl')
    expect(entries.length).toBeGreaterThanOrEqual(1)

    const last = entries[entries.length - 1] as Record<string, unknown>
    expect(last.event).toBe('test_event')
    expect(last.level).toBe('info')
    expect(last.key).toBe('value')
    expect(last.ts).toBeDefined()
  })

  test('logOperation writes structured tool call entry', () => {
    const logger = new JsonlLogger(testDir)
    logger.logOperation({
      level: 'info',
      sessionId: 'sess_test',
      event: 'tool_call',
      tool: 'bash',
      input: 'ls -la',
      outputSummary: 'listed 12 files',
      durationMs: 45,
      model: 'gpt-5.3-codex-medium',
    })

    const entries = logger.readEntries('operations.jsonl')
    const last = entries[entries.length - 1] as Record<string, unknown>
    expect(last.tool).toBe('bash')
    expect(last.durationMs).toBe(45)
  })

  test('logRequest writes to requests.jsonl', () => {
    const logger = new JsonlLogger(testDir)
    logger.logRequest({
      id: 'req_001',
      sessionId: 'sess_test',
      model: 'gpt-5.3-codex-medium',
      provider: 'openai-codex',
      userPrompt: 'hello',
      response: 'hi',
      reasoningContent: 'checked prompt first',
      stopReason: 'end_turn',
      toolUseCount: 0,
      tokens: { input: 100, output: 50, reasoning: 25 },
      cost: 0.001,
      durationMs: 123,
    })

    const entries = logger.readEntries('requests.jsonl')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const last = entries[entries.length - 1] as Record<string, unknown>
    expect(last.model).toBe('gpt-5.3-codex-medium')
    expect(last.stopReason).toBe('end_turn')
    expect(last.toolUseCount).toBe(0)
    expect(last.durationMs).toBe(123)
    expect(last.reasoningContent).toBe('checked prompt first')
    expect((last.tokens as Record<string, unknown>).reasoning).toBe(25)
  })

  test('logSessionRequest writes to session-scoped requests ledger', () => {
    const logger = new JsonlLogger(testDir)
    logger.logSessionRequest({
      id: 'req_session_001',
      sessionId: 'sess_scoped',
      model: 'gpt-5.4',
      provider: 'openai-codex',
      userPrompt: 'full prompt',
      response: 'full response',
      stopReason: 'end_turn',
      toolUseCount: 1,
      tokens: { input: 10, output: 20 },
      cost: 0.123,
      durationMs: 456,
    })

    const entries = logger.readSessionRequests('sess_scoped')
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('req_session_001')
    expect(entries[0].durationMs).toBe(456)
  })

  test('readSessionRequests falls back to legacy global requests file', () => {
    const logger = new JsonlLogger(testDir)
    logger.logRequest({
      id: 'req_legacy_001',
      sessionId: 'sess_legacy',
      model: 'gpt-5.3-codex-medium',
      provider: 'openai-codex',
      userPrompt: 'legacy prompt',
      response: 'legacy response',
      stopReason: 'end_turn',
      toolUseCount: 0,
      tokens: { input: 1, output: 2 },
      cost: 0.01,
    })

    const entries = logger.readSessionRequests('sess_legacy')
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('req_legacy_001')
  })

  test('readAllRequests merges legacy and session-scoped ledgers', () => {
    const logger = new JsonlLogger(testDir)
    logger.logRequest({
      id: 'req_global_001',
      sessionId: 'sess_global',
      model: 'gpt-5.3-codex-medium',
      provider: 'openai-codex',
      userPrompt: 'global prompt',
      response: 'global response',
      stopReason: 'end_turn',
      toolUseCount: 0,
      tokens: { input: 1, output: 2 },
      cost: 0.01,
    })
    logger.logSessionRequest({
      id: 'req_scoped_001',
      sessionId: 'sess_scoped_all',
      model: 'gpt-5.4',
      provider: 'openai-codex',
      userPrompt: 'scoped prompt',
      response: 'scoped response',
      stopReason: 'end_turn',
      toolUseCount: 0,
      tokens: { input: 3, output: 4 },
      cost: 0.02,
    })

    const entries = logger.readAllRequests()
    const ids = new Set(entries.map((entry) => entry.id))
    expect(ids.has('req_global_001')).toBe(true)
    expect(ids.has('req_scoped_001')).toBe(true)
  })

  test('logSessionClosure writes to session-scoped closure ledger', () => {
    const logger = new JsonlLogger(testDir)
    logger.logSessionClosure({
      sessionId: 'sess_closure',
      event: 'task_closure_decision',
      action: 'finish',
      reason: 'sufficient_coverage',
      assistantMessageId: 'msg_001',
    })

    const entries = logger.readSessionClosures('sess_closure')
    expect(entries).toHaveLength(1)
    expect(entries[0].event).toBe('task_closure_decision')
    expect(entries[0].assistantMessageId).toBe('msg_001')
  })

  test('readSessionClosures falls back to legacy operations log', () => {
    const logger = new JsonlLogger(testDir)
    logger.log('info', 'task_closure_skipped', {
      sessionId: 'sess_closure_legacy',
      skipReason: 'tool_use',
    })

    const entries = logger.readSessionClosures('sess_closure_legacy')
    expect(entries).toHaveLength(1)
    expect(entries[0].event).toBe('task_closure_skipped')
    expect(entries[0].skipReason).toBe('tool_use')
  })

  test('logSnapshot writes to snapshots.jsonl', () => {
    const logger = new JsonlLogger(testDir)
    logger.logSnapshot({
      id: 'snap_001',
      sessionId: 'sess_test',
      trigger: 'session_start',
      model: 'openai-codex/gpt-5.4',
      systemPrompt: 'You are ZeRo OS',
      tools: ['read', 'write', 'bash'],
      compressedRange: '0..3',
    })

    const entries = logger.readSessionSnapshots('sess_test')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const last = entries[entries.length - 1] as Record<string, unknown>
    expect(last.trigger).toBe('session_start')
    expect(last.model).toBe('openai-codex/gpt-5.4')
    expect(last.compressedRange).toBe('0..3')
  })

  test('readEntries returns empty array for missing file', () => {
    const logger = new JsonlLogger(testDir)
    const entries = logger.readEntries('nonexistent.jsonl')
    expect(entries).toEqual([])
  })
})
