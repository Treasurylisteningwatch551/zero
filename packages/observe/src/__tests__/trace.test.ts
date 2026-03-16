import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Tracer } from '../trace'

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined()
  if (value == null) {
    throw new Error('Expected value to be defined')
  }
  return value
}

describe('Tracer', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('start and end a root span', () => {
    const tracer = new Tracer()
    const span = tracer.startSpan('sess_001', 'handle_message')
    expect(span.status).toBe('running')
    expect(span.sessionId).toBe('sess_001')

    tracer.endSpan(span.id, 'success', { tokensUsed: 500 })
    const ended = expectDefined(tracer.getSpan(span.id))
    expect(ended.status).toBe('success')
    expect(ended.durationMs).toBeGreaterThanOrEqual(0)
    expect(ended.metadata?.tokensUsed).toBe(500)
  })

  test('child spans link to parent', () => {
    const tracer = new Tracer()
    const root = tracer.startSpan('sess_001', 'agent_loop')
    const child = tracer.startSpan('sess_001', 'tool_call:bash', root.id)

    expect(child.parentId).toBe(root.id)
    expect(root.children).toHaveLength(1)
    expect(root.children[0].id).toBe(child.id)
  })

  test('getSessionTraces returns root spans for a session', () => {
    const tracer = new Tracer()
    tracer.startSpan('sess_001', 'trace_1')
    tracer.startSpan('sess_001', 'trace_2')
    tracer.startSpan('sess_002', 'trace_3')

    const traces = tracer.getSessionTraces('sess_001')
    expect(traces).toHaveLength(2)
  })

  test('exportSession returns full trace tree', () => {
    const tracer = new Tracer()
    const root = tracer.startSpan('sess_001', 'main')
    tracer.startSpan('sess_001', 'child_1', root.id)
    tracer.startSpan('sess_001', 'child_2', root.id)

    const exported = tracer.exportSession('sess_001')
    expect(exported).toHaveLength(1)
    expect(exported[0].children).toHaveLength(2)
  })

  test('persists ended spans to session trace.jsonl', () => {
    const logsDir = mkdtempSync(join(tmpdir(), 'zero-trace-'))
    tempDirs.push(logsDir)
    const sessionId = 'sess_20260316_1423_web_a1b2'
    const tracer = new Tracer(logsDir)

    const root = tracer.startSpan(sessionId, 'turn:web', undefined, {
      kind: 'turn',
      agentName: 'web',
      data: { turnIndex: 1 },
    })
    tracer.updateSpan(root.id, {
      data: { requestCount: 1 },
      metadata: { source: 'test' },
    })
    tracer.endSpan(root.id, 'success')

    const tracePath = join(logsDir, 'sessions', '2026-03-16', sessionId, 'trace.jsonl')
    expect(existsSync(tracePath)).toBe(true)

    const [entry] = readFileSync(tracePath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(entry.spanId).toBe(root.id)
    expect(entry.kind).toBe('turn')
    expect(entry.agentName).toBe('web')
    expect(entry.data).toEqual({ turnIndex: 1, requestCount: 1 })
    expect(entry.metadata).toEqual({ source: 'test' })
  })

  test('exportSession rebuilds persisted tree and overlays running spans', () => {
    const logsDir = mkdtempSync(join(tmpdir(), 'zero-trace-'))
    tempDirs.push(logsDir)
    const sessionId = 'sess_20260316_1423_web_a1b2'
    const tracer = new Tracer(logsDir)

    const root = tracer.startSpan(sessionId, 'turn:web', undefined, { kind: 'turn' })
    const child = tracer.startSpan(sessionId, 'llm_request', root.id, { kind: 'llm_request' })
    tracer.endSpan(child.id, 'success')
    tracer.endSpan(root.id, 'success')

    const runningRoot = tracer.startSpan(sessionId, 'turn:running', undefined, { kind: 'turn' })
    tracer.startSpan(sessionId, 'tool:read', runningRoot.id, { kind: 'tool_call' })

    const exported = tracer.exportSession(sessionId)
    expect(exported).toHaveLength(2)
    expect(exported[0].children).toHaveLength(1)
    expect(exported[0].children[0].name).toBe('llm_request')
    expect(exported[1].name).toBe('turn:running')
    expect(exported[1].children).toHaveLength(1)
    expect(exported[1].children[0].status).toBe('running')
  })

  test('clear removes all spans', () => {
    const tracer = new Tracer()
    tracer.startSpan('sess_001', 'to_clear')
    tracer.clear()
    expect(tracer.getSessionTraces('sess_001')).toHaveLength(0)
  })
})
