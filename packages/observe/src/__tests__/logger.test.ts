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
      tokens: { input: 100, output: 50 },
      cost: 0.001,
    })

    const entries = logger.readEntries('requests.jsonl')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const last = entries[entries.length - 1] as Record<string, unknown>
    expect(last.model).toBe('gpt-5.3-codex-medium')
  })

  test('logSnapshot writes to snapshots.jsonl', () => {
    const logger = new JsonlLogger(testDir)
    logger.logSnapshot({
      id: 'snap_001',
      sessionId: 'sess_test',
      trigger: 'session_start',
      systemPrompt: 'You are ZeRo OS',
      tools: ['read', 'write', 'bash'],
    })

    const entries = logger.readEntries('snapshots.jsonl')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const last = entries[entries.length - 1] as Record<string, unknown>
    expect(last.trigger).toBe('session_start')
  })

  test('readEntries returns empty array for missing file', () => {
    const logger = new JsonlLogger(testDir)
    const entries = logger.readEntries('nonexistent.jsonl')
    expect(entries).toEqual([])
  })
})
