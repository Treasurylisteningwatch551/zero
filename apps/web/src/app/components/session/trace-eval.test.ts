import { describe, expect, test } from 'bun:test'
import type { SessionTaskClosureEvent, TraceSpan } from './timeline'
import { evaluateTraceSession } from './trace-eval'

describe('evaluateTraceSession', () => {
  test('returns resolved verdict for successful traced completion', () => {
    const traces: TraceSpan[] = [
      {
        id: 'turn_1',
        sessionId: 'sess_1',
        name: 'turn:zero',
        startTime: '2026-03-08T00:00:00.000Z',
        endTime: '2026-03-08T00:00:06.000Z',
        durationMs: 6000,
        status: 'success',
        children: [
          {
            id: 'req_1',
            parentId: 'turn_1',
            sessionId: 'sess_1',
            name: 'llm_request',
            startTime: '2026-03-08T00:00:00.100Z',
            endTime: '2026-03-08T00:00:01.000Z',
            durationMs: 900,
            status: 'success',
            children: [
              {
                id: 'tool_1',
                parentId: 'req_1',
                sessionId: 'sess_1',
                name: 'tool:read',
                startTime: '2026-03-08T00:00:01.100Z',
                endTime: '2026-03-08T00:00:01.300Z',
                durationMs: 200,
                status: 'success',
                metadata: {
                  toolUseId: 'call_1',
                  toolName: 'read',
                },
                children: [],
              },
            ],
          },
          {
            id: 'closure_1',
            parentId: 'turn_1',
            sessionId: 'sess_1',
            name: 'task_closure_decision',
            startTime: '2026-03-08T00:00:05.000Z',
            endTime: '2026-03-08T00:00:05.100Z',
            durationMs: 100,
            status: 'success',
            data: {
              closure: {
                event: 'task_closure_decision',
                action: 'finish',
                reason: 'task is done',
                assistantMessageId: 'msg_1',
                assistantMessageCreatedAt: '2026-03-08T00:00:05.200Z',
                classifierRequest: {
                  system: 'judge',
                  prompt: 'judge prompt',
                  maxTokens: 200,
                },
              },
            },
            children: [],
          },
        ],
      },
    ]

    const events: SessionTaskClosureEvent[] = [
      {
        ts: '2026-03-08T00:00:05.100Z',
        event: 'task_closure_decision',
        action: 'finish',
        reason: 'task is done',
        assistantMessageId: 'msg_1',
        assistantMessageCreatedAt: '2026-03-08T00:00:05.200Z',
        classifierRequest: {
          system: 'judge',
          prompt: 'judge prompt',
          maxTokens: 200,
        },
      },
    ]

    const report = evaluateTraceSession({
      traces,
      taskClosureEvents: events,
      llmRequests: [
        {
          id: 'req_1',
          stopReason: 'end_turn',
          toolUseCount: 1,
          durationMs: 900,
          cost: 0.012,
          ts: '2026-03-08T00:00:01.000Z',
        },
      ],
    })

    expect(report.verdict).toBe('resolved')
    expect(report.confidence).toBe('high')
    expect(report.score).toBeGreaterThanOrEqual(85)
    expect(report.metrics.finishCount).toBe(1)
  })

  test('flags review when closure is missing and tool failures accumulate', () => {
    const traces: TraceSpan[] = [
      {
        id: 'turn_1',
        sessionId: 'sess_1',
        name: 'turn:zero',
        startTime: '2026-03-08T00:00:00.000Z',
        endTime: '2026-03-08T00:00:10.000Z',
        durationMs: 10000,
        status: 'success',
        children: [
          {
            id: 'req_1',
            parentId: 'turn_1',
            sessionId: 'sess_1',
            name: 'llm_request',
            startTime: '2026-03-08T00:00:00.100Z',
            endTime: '2026-03-08T00:00:01.000Z',
            durationMs: 900,
            status: 'success',
            children: [],
          },
          {
            id: 'tool_1',
            parentId: 'req_1',
            sessionId: 'sess_1',
            name: 'tool:bash',
            startTime: '2026-03-08T00:00:01.100Z',
            endTime: '2026-03-08T00:00:02.000Z',
            durationMs: 900,
            status: 'error',
            metadata: {
              toolUseId: 'call_1',
              toolName: 'bash',
            },
            children: [],
          },
          {
            id: 'tool_2',
            parentId: 'req_1',
            sessionId: 'sess_1',
            name: 'tool:bash',
            startTime: '2026-03-08T00:00:02.100Z',
            endTime: '2026-03-08T00:00:03.000Z',
            durationMs: 900,
            status: 'error',
            metadata: {
              toolUseId: 'call_2',
              toolName: 'bash',
            },
            children: [],
          },
        ],
      },
    ]

    const report = evaluateTraceSession({
      traces,
      llmRequests: [
        {
          id: 'req_1',
          stopReason: 'tool_use',
          toolUseCount: 2,
          durationMs: 900,
          cost: 0.02,
          ts: '2026-03-08T00:00:01.000Z',
        },
      ],
    })

    expect(report.verdict).toBe('needs_review')
    expect(report.confidence).toBe('medium')
    expect(report.metrics.toolErrorCount).toBe(2)
    expect(report.highlights.some((item) => item.text.includes('No task closure decision'))).toBe(
      true,
    )
  })
})
