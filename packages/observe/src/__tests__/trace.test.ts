import { describe, test, expect } from 'bun:test'
import { Tracer } from '../trace'

describe('Tracer', () => {
  test('start and end a root span', () => {
    const tracer = new Tracer()
    const span = tracer.startSpan('sess_001', 'handle_message')
    expect(span.status).toBe('running')
    expect(span.sessionId).toBe('sess_001')

    tracer.endSpan(span.id, 'success', { tokensUsed: 500 })
    const ended = tracer.getSpan(span.id)!
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

  test('clear removes all spans', () => {
    const tracer = new Tracer()
    tracer.startSpan('sess_001', 'to_clear')
    tracer.clear()
    expect(tracer.getSessionTraces('sess_001')).toHaveLength(0)
  })
})
