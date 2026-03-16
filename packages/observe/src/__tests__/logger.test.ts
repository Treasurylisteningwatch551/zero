import { afterAll, describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, readlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { JsonlLogger } from '../logger'
import type { TraceEntry } from '../trace'

const testDir = join(import.meta.dir, '__fixtures__/logs')

describe('JsonlLogger', () => {
  afterAll(() => {
    rmSync(join(import.meta.dir, '__fixtures__'), { recursive: true, force: true })
  })

  test('log writes to events.jsonl', () => {
    const logger = new JsonlLogger(testDir)
    logger.log('info', 'test_event', { key: 'value' })

    const entries = logger.readEntries('events.jsonl')
    expect(entries.length).toBeGreaterThanOrEqual(1)

    const last = entries[entries.length - 1] as Record<string, unknown>
    expect(last.event).toBe('test_event')
    expect(last.level).toBe('info')
    expect(last.key).toBe('value')
    expect(last.ts).toBeDefined()
  })

  test('logEvent writes structured event entry', () => {
    const logger = new JsonlLogger(testDir)
    logger.logEvent({
      level: 'info',
      sessionId: 'sess_test',
      event: 'tool_call',
      tool: 'bash',
      input: 'ls -la',
      outputSummary: 'listed 12 files',
      durationMs: 45,
      model: 'gpt-5.3-codex-medium',
    })

    const entries = logger.readEntries('events.jsonl')
    const last = entries[entries.length - 1] as Record<string, unknown>
    expect(last.tool).toBe('bash')
    expect(last.durationMs).toBe(45)
  })

  test('constructor migrates legacy operations.jsonl into events.jsonl', () => {
    mkdirSync(testDir, { recursive: true })
    appendFileSync(
      join(testDir, 'operations.jsonl'),
      `${JSON.stringify({
        ts: '2026-03-16T00:00:00.000Z',
        level: 'info',
        event: 'legacy_event',
      })}\n`,
      'utf-8',
    )

    const logger = new JsonlLogger(testDir)
    const entries = logger.readEntries<Record<string, unknown>>('events.jsonl')

    expect(entries.some((entry) => entry.event === 'legacy_event')).toBe(true)
    expect(existsSync(join(testDir, 'operations.jsonl'))).toBe(false)
  })

  test('logRequest writes to requests.jsonl', () => {
    const logger = new JsonlLogger(testDir)
    logger.logRequest({
      id: 'req_001',
      turnIndex: 1,
      sessionId: 'sess_test',
      agentName: 'zero',
      model: 'gpt-5.3-codex-medium',
      provider: 'openai-codex',
      userPrompt: 'hello',
      response: 'hi',
      reasoningContent: 'checked prompt first',
      stopReason: 'end_turn',
      toolUseCount: 0,
      toolCalls: [],
      toolResults: [
        {
          type: 'tool_result',
          toolUseId: 'call_0',
          content: 'tool output passed to next request',
          outputSummary: 'tool output passed to next request',
        },
      ],
      toolNames: ['read', 'bash'],
      toolDefinitionsHash: 'tools-hash',
      systemHash: 'system-hash',
      staticPrefixHash: 'prefix-hash',
      messageCount: 3,
      tokens: { input: 100, output: 50, reasoning: 25 },
      cost: 0.001,
      durationMs: 123,
    })

    const entries = logger.readEntries('requests.jsonl')
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const last = entries[entries.length - 1] as Record<string, unknown>
    expect(last.agentName).toBe('zero')
    expect(last.model).toBe('gpt-5.3-codex-medium')
    expect(last.stopReason).toBe('end_turn')
    expect(last.toolUseCount).toBe(0)
    expect(last.durationMs).toBe(123)
    expect(last.reasoningContent).toBe('checked prompt first')
    expect(last.toolNames).toEqual(['read', 'bash'])
    expect(last.toolDefinitionsHash).toBe('tools-hash')
    expect(last.systemHash).toBe('system-hash')
    expect(last.staticPrefixHash).toBe('prefix-hash')
    expect(last.messageCount).toBe(3)
    expect(last.toolResults).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'call_0',
        content: 'tool output passed to next request',
        outputSummary: 'tool output passed to next request',
      },
    ])
    expect((last.tokens as Record<string, unknown>).reasoning).toBe(25)
  })

  test('logSessionRequest writes to session-scoped requests ledger', () => {
    const logger = new JsonlLogger(testDir)
    logger.logSessionRequest({
      id: 'req_session_001',
      turnIndex: 1,
      sessionId: 'sess_scoped',
      agentName: 'Explorer',
      spawnedByRequestId: 'req_parent_001',
      model: 'gpt-5.4',
      provider: 'openai-codex',
      userPrompt: 'full prompt',
      response: 'full response',
      stopReason: 'end_turn',
      toolUseCount: 1,
      toolCalls: [{ id: 'call_1', name: 'read', input: { path: '/tmp/file.txt' } }],
      toolResults: [
        {
          type: 'tool_result',
          toolUseId: 'call_1',
          content: 'file contents here',
          outputSummary: 'file contents here',
        },
      ],
      tokens: { input: 10, output: 20 },
      cost: 0.123,
      durationMs: 456,
    })

    const entries = logger.readSessionRequests('sess_scoped')
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('req_session_001')
    expect(entries[0].agentName).toBe('Explorer')
    expect(entries[0].spawnedByRequestId).toBe('req_parent_001')
    expect(entries[0].durationMs).toBe(456)
    expect(entries[0].toolCalls).toEqual([
      { id: 'call_1', name: 'read', input: { path: '/tmp/file.txt' } },
    ])
    expect(entries[0].toolResults).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'call_1',
        content: 'file contents here',
        outputSummary: 'file contents here',
      },
    ])
  })

  test('logSessionRequest uses dated layout for generated-style session ids', () => {
    const logger = new JsonlLogger(testDir)
    const sessionId = 'sess_20260313_1423_fei_a1b2'

    logger.logSessionRequest({
      id: 'req_session_dated',
      turnIndex: 1,
      sessionId,
      model: 'gpt-5.4',
      provider: 'openai-codex',
      userPrompt: 'dated prompt',
      response: 'dated response',
      stopReason: 'end_turn',
      toolUseCount: 0,
      tokens: { input: 1, output: 2 },
      cost: 0.01,
    })

    expect(existsSync(join(testDir, 'sessions', '2026-03-13', sessionId, 'requests.jsonl'))).toBe(
      true,
    )
    expect(logger.readSessionRequests(sessionId)).toHaveLength(1)
  })

  test('readSessionRequests falls back to legacy global requests file', () => {
    const logger = new JsonlLogger(testDir)
    logger.logRequest({
      id: 'req_legacy_001',
      turnIndex: 1,
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
    expect(entries[0].toolCalls).toEqual([])
    expect(entries[0].toolResults).toEqual([])
  })

  test('readSessionRequests normalizes missing toolCalls and toolResults from legacy lines', () => {
    const logger = new JsonlLogger(testDir)
    const sessionId = 'sess_20260313_0000_leg_abcd'
    const sessionDir = join(testDir, 'sessions', '2026-03-13', sessionId)
    const filePath = join(sessionDir, 'requests.jsonl')
    mkdirSync(sessionDir, {
      recursive: true,
    })
    appendFileSync(
      filePath,
      `${JSON.stringify({
        id: 'req_missing_toolcalls',
        turnIndex: 1,
        sessionId,
        model: 'gpt-5.4',
        provider: 'openai-codex',
        userPrompt: 'legacy prompt',
        response: 'legacy response',
        stopReason: 'end_turn',
        toolUseCount: 0,
        tokens: { input: 1, output: 2 },
        cost: 0.01,
        ts: '2026-03-13T00:00:00.000Z',
      })}\n`,
      'utf-8',
    )

    const entries = logger.readSessionRequests(sessionId)
    expect(entries).toHaveLength(1)
    expect(entries[0].toolCalls).toEqual([])
    expect(entries[0].toolResults).toEqual([])
  })

  test('readSessionRequests prefers trace.jsonl over request ledgers', () => {
    const logger = new JsonlLogger(testDir)
    const sessionId = 'sess_20260316_0100_web_trace'

    logger.logSessionRequest({
      id: 'req_ledger_001',
      turnIndex: 1,
      sessionId,
      model: 'ledger-model',
      provider: 'ledger-provider',
      userPrompt: 'legacy prompt',
      response: 'legacy response',
      stopReason: 'end_turn',
      toolUseCount: 0,
      tokens: { input: 1, output: 2 },
      cost: 0.01,
    })

    writeSessionTraceEntries(testDir, sessionId, [
      {
        spanId: 'span_req_001',
        sessionId,
        kind: 'llm_request',
        name: 'llm_request',
        startTime: '2026-03-16T01:00:00.000Z',
        endTime: '2026-03-16T01:00:01.000Z',
        durationMs: 1000,
        status: 'success',
        data: {
          request: {
            id: 'req_trace_001',
            turnIndex: 2,
            sessionId,
            agentName: 'trace-agent',
            model: 'trace-model',
            provider: 'trace-provider',
            userPrompt: 'trace prompt',
            response: 'trace response',
            stopReason: 'end_turn',
            toolUseCount: 0,
            toolCalls: [],
            toolResults: [],
            tokens: { input: 3, output: 4 },
            cost: 0.02,
            durationMs: 1000,
          },
        },
      },
    ])

    const entries = logger.readSessionRequests(sessionId)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('req_trace_001')
    expect(entries[0].model).toBe('trace-model')
  })

  test('readSessionRequests falls back to ledgers when trace entries are not projectable', () => {
    const logger = new JsonlLogger(testDir)
    const sessionId = 'sess_20260316_0110_web_trace'

    logger.logSessionRequest({
      id: 'req_ledger_fallback',
      turnIndex: 1,
      sessionId,
      model: 'ledger-model',
      provider: 'ledger-provider',
      userPrompt: 'legacy prompt',
      response: 'legacy response',
      stopReason: 'end_turn',
      toolUseCount: 0,
      tokens: { input: 1, output: 2 },
      cost: 0.01,
    })

    writeSessionTraceEntries(testDir, sessionId, [
      {
        spanId: 'span_req_incomplete',
        sessionId,
        kind: 'llm_request',
        name: 'llm_request',
        startTime: '2026-03-16T01:10:00.000Z',
        endTime: '2026-03-16T01:10:01.000Z',
        durationMs: 1000,
        status: 'success',
        data: {
          requestId: 'old-shape-only',
        },
      },
    ])

    const entries = logger.readSessionRequests(sessionId)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('req_ledger_fallback')
  })

  test('readAllRequests merges legacy and session-scoped ledgers', () => {
    const logger = new JsonlLogger(testDir)
    logger.logRequest({
      id: 'req_global_001',
      turnIndex: 1,
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
      turnIndex: 1,
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

  test('syncSessionActiveState maintains _active symlinks for active sessions only', () => {
    const logger = new JsonlLogger(testDir)
    const sessionId = 'sess_20260312_2130_fei_a1b2'

    logger.syncSessionActiveState(sessionId, 'active')
    const linkPath = join(testDir, 'sessions', '_active', sessionId)

    expect(existsSync(linkPath)).toBe(true)
    expect(readlinkSync(linkPath)).toBe('../2026-03-12/sess_20260312_2130_fei_a1b2')

    logger.syncSessionActiveState(sessionId, 'completed')
    expect(existsSync(linkPath)).toBe(false)
  })

  test('logSessionClosure writes to session-scoped closure ledger', () => {
    const logger = new JsonlLogger(testDir)
    logger.logSessionClosure({
      sessionId: 'sess_closure',
      event: 'task_closure_decision',
      action: 'finish',
      reason: 'sufficient_coverage',
      assistantMessageId: 'msg_001',
      classifierRequest: {
        system: 'strict classifier',
        prompt: '<instruction>prompt</instruction>',
        maxTokens: 200,
      },
      classifierResponse: {
        id: 'resp_classifier_1',
        model: 'fake-model',
        stopReason: 'end_turn' as const,
        usage: { input: 5, output: 7 },
        reasoningContent: 'classifier reasoning',
        content: [
          {
            type: 'text' as const,
            text: '{"action":"finish","reason":"sufficient_coverage","trimFrom":""}',
          },
        ],
      },
    })

    const entries = logger.readSessionClosures('sess_closure')
    expect(entries).toHaveLength(1)
    expect(entries[0].event).toBe('task_closure_decision')
    expect(entries[0].assistantMessageId).toBe('msg_001')
    expect(entries[0].classifierResponse).toEqual({
      id: 'resp_classifier_1',
      model: 'fake-model',
      stopReason: 'end_turn' as const,
      usage: { input: 5, output: 7 },
      reasoningContent: 'classifier reasoning',
      content: [
        {
          type: 'text' as const,
          text: '{"action":"finish","reason":"sufficient_coverage","trimFrom":""}',
        },
      ],
    })
  })

  test('logSessionClosure deduplicates repeated closure entries', () => {
    const logger = new JsonlLogger(testDir)
    const entry = {
      sessionId: 'sess_closure_dedupe',
      event: 'task_closure_failed' as const,
      reason: 'invalid_classifier_output' as const,
      failureStage: 'parse_classifier_response' as const,
      assistantMessageId: 'msg_failed',
      classifierRequest: {
        system: 'strict classifier',
        prompt: '<instruction>prompt</instruction>',
        maxTokens: 200,
      },
      classifierResponse: {
        id: 'resp_classifier_bad',
        model: 'fake-model',
        stopReason: 'end_turn' as const,
        usage: { input: 5, output: 3 },
        reasoningContent: 'classifier reasoning bad',
        content: [{ type: 'text' as const, text: 'not-json' }],
      },
      classifierResponseRaw: 'not-json',
    }

    logger.logSessionClosure(entry)
    logger.logSessionClosure(entry)

    const entries = logger.readSessionClosures('sess_closure_dedupe')
    expect(entries).toHaveLength(1)
    expect(entries[0].event).toBe('task_closure_failed')
  })

  test('readSessionClosures does not fall back to events log', () => {
    const logger = new JsonlLogger(testDir)
    logger.log('info', 'task_closure_failed', {
      sessionId: 'sess_closure_legacy',
      reason: 'classifier_failed',
    })

    const entries = logger.readSessionClosures('sess_closure_legacy')
    expect(entries).toHaveLength(0)
  })

  test('readSessionClosures prefers trace.jsonl over closure ledgers', () => {
    const logger = new JsonlLogger(testDir)
    const sessionId = 'sess_20260316_0120_web_trace'

    logger.logSessionClosure({
      sessionId,
      event: 'task_closure_failed',
      reason: 'classifier_failed',
      failureStage: 'request_classifier',
      classifierRequest: {
        system: 'legacy system',
        prompt: 'legacy prompt',
        maxTokens: 200,
      },
    })

    writeSessionTraceEntries(testDir, sessionId, [
      {
        spanId: 'span_closure_001',
        sessionId,
        kind: 'closure_decision',
        name: 'task_closure_decision',
        startTime: '2026-03-16T01:20:00.000Z',
        endTime: '2026-03-16T01:20:01.000Z',
        durationMs: 1000,
        status: 'success',
        data: {
          closure: {
            event: 'task_closure_decision',
            action: 'finish',
            reason: 'trace_complete',
            classifierRequest: {
              system: 'trace system',
              prompt: 'trace prompt',
              maxTokens: 200,
            },
            assistantMessageId: 'msg_trace_001',
          },
        },
      },
    ])

    const entries = logger.readSessionClosures(sessionId)
    expect(entries).toHaveLength(1)
    expect(entries[0].event).toBe('task_closure_decision')
    expect(entries[0].assistantMessageId).toBe('msg_trace_001')
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
    const last = entries[entries.length - 1]
    expect(last.trigger).toBe('session_start')
    expect(last.model).toBe('openai-codex/gpt-5.4')
    expect(last.compressedRange).toBe('0..3')
  })

  test('readSessionSnapshots prefers trace.jsonl over snapshot ledgers', () => {
    const logger = new JsonlLogger(testDir)
    const sessionId = 'sess_20260316_0130_web_trace'

    logger.logSnapshot({
      id: 'snap_ledger_001',
      sessionId,
      trigger: 'session_start',
      model: 'ledger-model',
      systemPrompt: 'legacy system prompt',
    })

    writeSessionTraceEntries(testDir, sessionId, [
      {
        spanId: 'span_snapshot_001',
        sessionId,
        kind: 'snapshot',
        name: 'snapshot:context_updated',
        startTime: '2026-03-16T01:30:00.000Z',
        endTime: '2026-03-16T01:30:01.000Z',
        durationMs: 1000,
        status: 'success',
        data: {
          snapshot: {
            id: 'snap_trace_001',
            trigger: 'context_updated',
            model: 'trace-model',
            systemPrompt: 'trace system prompt',
            tools: ['read', 'bash'],
          },
        },
      },
    ])

    const entries = logger.readSessionSnapshots(sessionId)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('snap_trace_001')
    expect(entries[0].systemPrompt).toBe('trace system prompt')
  })

  test('readEntries returns empty array for missing file', () => {
    const logger = new JsonlLogger(testDir)
    const entries = logger.readEntries('nonexistent.jsonl')
    expect(entries).toEqual([])
  })
})

function writeSessionTraceEntries(baseDir: string, sessionId: string, entries: TraceEntry[]): void {
  const sessionDir = join(baseDir, 'sessions', sessionId)
  mkdirSync(sessionDir, { recursive: true })
  appendFileSync(
    join(sessionDir, 'trace.jsonl'),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf-8',
  )
}
