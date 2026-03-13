import { describe, expect, test } from 'bun:test'
import {
  type Message,
  type PersistedTaskClosureEvent,
  type TraceSpan,
  buildTimeline,
} from './timeline'

describe('buildTimeline', () => {
  test('adds task closure decision span as a system event', () => {
    const messages: Message[] = [
      {
        id: 'msg_1',
        role: 'user',
        messageType: 'message',
        content: [{ type: 'text', text: 'hello' }],
        createdAt: '2026-03-08T00:00:00.000Z',
      },
      {
        id: 'msg_2',
        role: 'assistant',
        messageType: 'message',
        content: [{ type: 'text', text: 'done' }],
        createdAt: '2026-03-08T00:00:01.000Z',
      },
    ]

    const traces: TraceSpan[] = [
      {
        id: 'span_1',
        sessionId: 'sess_1',
        name: 'agent.run:test',
        startTime: '2026-03-08T00:00:00.000Z',
        endTime: '2026-03-08T00:00:02.000Z',
        durationMs: 2000,
        status: 'success',
        children: [
          {
            id: 'span_2',
            parentId: 'span_1',
            sessionId: 'sess_1',
            name: 'task_closure_decision',
            startTime: '2026-03-08T00:00:01.100Z',
            endTime: '2026-03-08T00:00:01.200Z',
            durationMs: 100,
            status: 'success',
            metadata: {
              called: true,
              action: 'continue',
              reason: 'remaining work is required',
            },
            children: [],
          },
        ],
      },
    ]

    const items = buildTimeline(messages, traces)
    const systemEvent = items.find((item) => item.type === 'system-event')

    expect(systemEvent).toBeDefined()
    expect(systemEvent?.text).toContain('Task closure continue')
  })

  test('adds trim failed span as warning event', () => {
    const items = buildTimeline(
      [],
      [
        {
          id: 'span_trim',
          sessionId: 'sess_1',
          name: 'task_closure_trim_failed',
          startTime: '2026-03-08T00:00:01.000Z',
          endTime: '2026-03-08T00:00:01.100Z',
          durationMs: 100,
          status: 'error',
          metadata: { reason: 'trim_from_not_found' },
          children: [],
        },
      ],
    )

    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('system-event')
    if (items[0].type === 'system-event') {
      expect(items[0].variant).toBe('warning')
      expect(items[0].text).toContain('trim failed')
    }
  })
})

test('adds persisted task closure event when traces are unavailable', () => {
  const persisted: PersistedTaskClosureEvent[] = [
    {
      ts: '2026-03-08T00:00:03.000Z',
      event: 'task_closure_decision',
      action: 'continue',
      reason: 'remaining work is required',
    },
  ]

  const items = buildTimeline([], [], persisted)
  expect(items).toHaveLength(1)
  expect(items[0].type).toBe('system-event')
  if (items[0].type === 'system-event') {
    expect(items[0].text).toContain('Task closure continue')
  }
})

test('orders task closure event after its assistant message when assistant timestamp is available', () => {
  const messages: Message[] = [
    {
      id: 'msg_1',
      role: 'assistant',
      messageType: 'message',
      content: [{ type: 'text', text: 'analysis result' }],
      createdAt: '2026-03-08T00:00:02.000Z',
    },
  ]

  const traces: TraceSpan[] = [
    {
      id: 'span_1',
      sessionId: 'sess_1',
      name: 'task_closure_decision',
      startTime: '2026-03-08T00:00:01.100Z',
      endTime: '2026-03-08T00:00:01.200Z',
      durationMs: 100,
      status: 'success',
      metadata: {
        called: true,
        action: 'continue',
        reason: 'remaining work is required',
        assistantMessageId: 'msg_1',
        assistantMessageCreatedAt: '2026-03-08T00:00:02.000Z',
      },
      children: [],
    },
  ]

  const items = buildTimeline(messages, traces)
  expect(items).toHaveLength(2)
  expect(items[0].type).toBe('agent-text')
  expect(items[1].type).toBe('system-event')
})

test('deduplicates persisted task closure events when matching trace spans exist', () => {
  const traces: TraceSpan[] = [
    {
      id: 'span_1',
      sessionId: 'sess_1',
      name: 'task_closure_decision',
      startTime: '2026-03-08T00:00:01.000Z',
      endTime: '2026-03-08T00:00:01.100Z',
      durationMs: 100,
      status: 'success',
      metadata: {
        called: false,
        skipReason: 'tool_use',
        assistantMessageId: 'msg_1',
      },
      children: [],
    },
  ]

  const persisted: PersistedTaskClosureEvent[] = [
    {
      ts: '2026-03-08T00:00:01.200Z',
      event: 'task_closure_skipped',
      skipReason: 'tool_use',
      assistantMessageId: 'msg_1',
    },
  ]

  const items = buildTimeline([], traces, persisted)
  expect(items).toHaveLength(1)
  expect(items[0].type).toBe('system-event')
  if (items[0].type === 'system-event') {
    expect(items[0].text).toBe('Task closure skipped: tool_use')
  }
})
