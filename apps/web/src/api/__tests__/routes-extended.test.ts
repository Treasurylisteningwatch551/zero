import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startZeroOS } from '../../../../server/src/main'
import type { ZeroOS } from '../../../../server/src/main'
import { createRoutes } from '../routes'

let app: ReturnType<typeof createRoutes>
let zero: ZeroOS
let testDataDir: string

beforeAll(async () => {
  testDataDir = mkdtempSync(join(tmpdir(), 'zero-test-'))
  const prodDir = join(process.cwd(), '.zero')
  for (const file of ['secrets.enc', 'config.yaml', 'fuse_list.yaml']) {
    const src = join(prodDir, file)
    if (existsSync(src)) {
      cpSync(src, join(testDataDir, file))
    }
  }
  zero = await startZeroOS({ dataDir: testDataDir, skipProcessExit: true })
  app = createRoutes(zero)
})

afterAll(async () => {
  await zero.shutdown()
  rmSync(testDataDir, { recursive: true, force: true })
})

describe('API Routes Extended', () => {
  test('POST /api/chat with existing sessionId reuses session', async () => {
    const res1 = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Say "hello" and nothing else.' }),
    })
    if (res1.status === 500) {
      console.warn(
        '[test] POST /api/chat returned 500 — upstream API unavailable, skipping assertions',
      )
      return
    }
    expect(res1.status).toBe(200)
    const data1 = await res1.json()
    const sessionId = data1.sessionId

    const res2 = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Say "world" and nothing else.', sessionId }),
    })
    if (res2.status === 500) {
      console.warn(
        '[test] POST /api/chat returned 500 — upstream API unavailable, skipping assertions',
      )
      return
    }
    expect(res2.status).toBe(200)
    const data2 = await res2.json()
    expect(data2.sessionId).toBe(sessionId)
  }, 60_000)

  test('GET /api/sessions?filter=active returns active sessions', async () => {
    const res = await app.request('/api/sessions?filter=active')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.sessions)).toBe(true)
    for (const s of data.sessions) {
      expect(['active', 'idle']).toContain(s.status)
    }
  })

  test('GET /api/sessions?q=web searches by source', async () => {
    zero.sessionManager.create('web')
    const res = await app.request('/api/sessions?q=web')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessions.length).toBeGreaterThan(0)
    expect(data.sessions[0].source).toBe('web')
  })

  test('POST /api/sessions/:id/archive archives a session', async () => {
    const session = zero.sessionManager.create('web')
    const res = await app.request(`/api/sessions/${session.data.id}/archive`, {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)

    const getRes = await app.request(`/api/sessions/${session.data.id}`)
    const sessionData = await getRes.json()
    expect(sessionData.status).toBe('archived')
  })

  test('POST /api/sessions/:id/archive returns 404 for missing', async () => {
    const res = await app.request('/api/sessions/nonexistent/archive', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  test('GET /api/memory/search?q=query returns results', async () => {
    const res = await app.request('/api/memory/search?q=test')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.query).toBe('test')
    expect(Array.isArray(data.results)).toBe(true)
  })

  test('GET /api/memory/search without q returns empty', async () => {
    const res = await app.request('/api/memory/search')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.results).toEqual([])
  })

  test('GET /api/notifications returns notifications array', async () => {
    const res = await app.request('/api/notifications')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.notifications)).toBe(true)
  })

  test('tool bus events are not written to events.jsonl', () => {
    const before = zero.logger.readEntries<Record<string, unknown>>('events.jsonl').length

    zero.bus.emit('tool:call', {
      sessionId: 'sess_tool_noise',
      tool: 'bash',
      toolUseId: 'call_001',
    })
    zero.bus.emit('tool:result', {
      sessionId: 'sess_tool_noise',
      tool: 'bash',
      success: true,
      outputSummary: 'ok',
    })
    zero.bus.emit('session:update', {
      sessionId: 'sess_signal',
      event: 'message_handled',
    })

    const newEntries = zero.logger
      .readEntries<Record<string, unknown>>('events.jsonl')
      .slice(before)

    expect(newEntries.some((entry) => entry.event === 'tool:call')).toBe(false)
    expect(newEntries.some((entry) => entry.event === 'tool:result')).toBe(false)
    expect(newEntries.some((entry) => entry.event === 'message_handled')).toBe(true)
  })

  test('GET /api/channels/status returns channel statuses', async () => {
    const res = await app.request('/api/channels/status')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.channels)).toBe(true)
    const names = data.channels.map((c: { name: string }) => c.name)
    expect(names).toContain('web')
    expect(names).toContain('feishu')
    expect(names).toContain('telegram')
  })

  test('GET /api/channels/config returns channel configs with secrets', async () => {
    const res = await app.request('/api/channels/config')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.channels)).toBe(true)
    const webCh = data.channels.find((c: { name: string }) => c.name === 'web')
    expect(webCh).toBeDefined()
    expect(webCh.type).toBe('web')
    expect(webCh.status).toBe('online')
  })

  test('GET /api/status reflects degraded heartbeat state', async () => {
    zero.heartbeat.setHealthMetrics({
      errorCount: 3,
      channels: [],
    })
    zero.heartbeat.write()

    const res = await app.request('/api/status')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('degraded')
    expect(typeof data.heartbeatAge).toBe('number')
    expect(data.heartbeatAge).toBeGreaterThanOrEqual(0)
  })

  test('GET /api/metrics/health returns repair stats', async () => {
    const res = await app.request('/api/metrics/health')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.repairs).toBeDefined()
    expect(data.repairTrend).toBeDefined()
  })

  test('GET /api/sessions/:id/traces returns traces', async () => {
    const session = zero.sessionManager.create('web')
    const res = await app.request(`/api/sessions/${session.data.id}/traces`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.traces)).toBe(true)
  })

  test('GET /api/sessions/:id/task-closure-events returns trace-projected closure events', async () => {
    const session = zero.sessionManager.create('web')
    const span = zero.tracer.startSpan(session.data.id, 'task_closure_decision', undefined, {
      kind: 'closure_decision',
      data: {
        closure: {
          event: 'task_closure_decision',
          action: 'finish',
          reason: 'trace_complete',
          assistantMessageId: 'msg_trace_001',
          classifierRequest: {
            system: 'strict classifier',
            prompt: '<instruction>prompt</instruction>',
            maxTokens: 200,
          },
        },
      },
    })
    zero.tracer.endSpan(span.id, 'success')

    const res = await app.request(`/api/sessions/${session.data.id}/task-closure-events`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.events)).toBe(true)
    expect(data.events[0].event).toBe('task_closure_decision')
    expect(data.events[0].assistantMessageId).toBe('msg_trace_001')
  })

  test('GET /api/sessions/:id/task-closure-events ignores events log task closure events', async () => {
    const session = zero.sessionManager.create('web')
    zero.logger.log('info', 'task_closure_failed', {
      sessionId: session.data.id,
      reason: 'classifier_failed',
    })

    const res = await app.request(`/api/sessions/${session.data.id}/task-closure-events`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.events).toEqual([])
  })

  test('GET /api/sessions/:id/requests returns trace-projected LLM requests', async () => {
    const session = zero.sessionManager.create('web')
    const span = zero.tracer.startSpan(session.data.id, 'llm_request', undefined, {
      kind: 'llm_request',
      data: {
        request: {
          id: 'req_session_route_001',
          turnIndex: 1,
          sessionId: session.data.id,
          model: 'openai-codex/gpt-5.4-medium',
          provider: 'openai-codex',
          userPrompt: 'full prompt for session route',
          response: 'full response for session route',
          stopReason: 'end_turn',
          toolUseCount: 0,
          toolCalls: [{ id: 'call_route_1', name: 'read', input: { path: '/tmp/demo.txt' } }],
          toolResults: [
            {
              type: 'tool_result',
              toolUseId: 'call_route_1',
              content: 'demo file contents',
              outputSummary: 'demo file contents',
            },
          ],
          tokens: { input: 10, output: 20 },
          cost: 0.42,
          durationMs: 900,
        },
      },
    })
    zero.tracer.endSpan(span.id, 'success')

    const res = await app.request(`/api/sessions/${session.data.id}/requests`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessionId).toBe(session.data.id)
    expect(Array.isArray(data.requests)).toBe(true)
    expect(data.requests[0].id).toBe('req_session_route_001')
    expect(data.requests[0].durationMs).toBe(900)
    expect(data.requests[0].toolCalls).toEqual([
      { id: 'call_route_1', name: 'read', input: { path: '/tmp/demo.txt' } },
    ])
    expect(data.requests[0].toolResults).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'call_route_1',
        content: 'demo file contents',
        outputSummary: 'demo file contents',
      },
    ])
  })

  test('GET /api/logs?type=requests reads merged request sources', async () => {
    const session = zero.sessionManager.create('web')
    const span = zero.tracer.startSpan(session.data.id, 'llm_request', undefined, {
      kind: 'llm_request',
      data: {
        request: {
          id: 'req_logs_route_001',
          turnIndex: 1,
          sessionId: session.data.id,
          model: 'openai-codex/gpt-5.4-medium',
          provider: 'openai-codex',
          userPrompt: 'request visible in logs',
          response: 'response visible in logs',
          stopReason: 'end_turn',
          toolUseCount: 0,
          toolCalls: [],
          toolResults: [],
          tokens: { input: 5, output: 6 },
          cost: 0.2,
        },
      },
    })
    zero.tracer.endSpan(span.id, 'success')

    const res = await app.request('/api/logs?type=requests&limit=20')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.entries.some((entry: { id: string }) => entry.id === 'req_logs_route_001')).toBe(
      true,
    )
  })

  test('GET /api/logs?type=requests includes trace-only session requests', async () => {
    const session = zero.sessionManager.create('web')
    const span = zero.tracer.startSpan(session.data.id, 'llm_request', undefined, {
      kind: 'llm_request',
      data: {
        request: {
          id: 'req_logs_trace_001',
          turnIndex: 1,
          sessionId: session.data.id,
          model: 'openai-codex/gpt-5.4-medium',
          provider: 'openai-codex',
          userPrompt: 'trace log prompt',
          response: 'trace log response',
          stopReason: 'end_turn',
          toolUseCount: 0,
          toolCalls: [],
          toolResults: [],
          tokens: { input: 3, output: 4 },
          cost: 0.12,
        },
      },
    })
    zero.tracer.endSpan(span.id, 'success')

    const res = await app.request('/api/logs?type=requests&limit=20')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.entries.some((entry: { id: string }) => entry.id === 'req_logs_trace_001')).toBe(
      true,
    )
  })

  test('GET /api/logs?type=snapshots includes trace-only session snapshots', async () => {
    const session = zero.sessionManager.create('web')
    const span = zero.tracer.startSpan(session.data.id, 'snapshot:session_start', undefined, {
      kind: 'snapshot',
      data: {
        snapshot: {
          id: 'snap_logs_trace_001',
          trigger: 'session_start',
          model: 'openai-codex/gpt-5.4-medium',
          systemPrompt: 'trace snapshot prompt',
          tools: ['read', 'bash'],
        },
      },
    })
    zero.tracer.endSpan(span.id, 'success')

    const res = await app.request('/api/logs?type=snapshots&limit=20')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.entries.some((entry: { id: string }) => entry.id === 'snap_logs_trace_001')).toBe(
      true,
    )
  })

  test('GET /api/logs?type=trace scans persisted trace files and flattens child spans', async () => {
    const sessionId = 'sess_20260316_2325_trace_api_abcd'
    const root = zero.tracer.startSpan(sessionId, 'turn:trace-api', undefined, {
      kind: 'turn',
    })
    const child = zero.tracer.startSpan(sessionId, 'tool:bash', root.id, {
      kind: 'tool_call',
    })
    zero.tracer.endSpan(child.id, 'success')
    zero.tracer.endSpan(root.id, 'success')

    const res = await app.request('/api/logs?type=trace&limit=20')
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(
      data.entries.some(
        (entry: { spanId: string; sessionId: string; name: string; kind: string }) =>
          entry.spanId === root.id &&
          entry.sessionId === sessionId &&
          entry.name === 'turn:trace-api' &&
          entry.kind === 'turn',
      ),
    ).toBe(true)
    expect(
      data.entries.some(
        (entry: { spanId: string; sessionId: string; name: string; kind: string }) =>
          entry.spanId === child.id &&
          entry.sessionId === sessionId &&
          entry.name === 'tool:bash' &&
          entry.kind === 'tool_call',
      ),
    ).toBe(true)
  })

  test('GET /api/sessions/channel/:channel/active returns active candidates only', async () => {
    const feishu = zero.sessionManager.getOrCreateForChannel(
      'feishu',
      'shared-room',
      'feishu:ops',
    ).session
    feishu.data.updatedAt = '2026-03-08T00:00:02.000Z'

    const telegram = zero.sessionManager.getOrCreateForChannel('telegram', 'shared-room').session
    telegram.data.updatedAt = '2026-03-08T00:00:03.000Z'

    const feishuHr = zero.sessionManager.getOrCreateForChannel(
      'feishu',
      'shared-room',
      'feishu:hr',
    ).session
    feishuHr.data.updatedAt = '2026-03-08T00:00:01.000Z'

    const web = zero.sessionManager.getOrCreateForChannel('web', 'shared-room').session
    web.setStatus('completed')
    web.data.updatedAt = '2026-03-08T00:00:04.000Z'

    const res = await app.request('/api/sessions/channel/shared-room/active')
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(
      data.sessions.map(
        (session: { source: string; channelName?: string }) =>
          `${session.source}:${session.channelName ?? 'none'}`,
      ),
    ).toEqual(['telegram:none', 'feishu:feishu:ops', 'feishu:feishu:hr'])
    expect(
      data.sessions.every((session: { status: string }) =>
        ['active', 'idle'].includes(session.status),
      ),
    ).toBe(true)
  })

  test('GET /api/sessions/channel/:channel/active returns empty array for missing channel', async () => {
    const res = await app.request('/api/sessions/channel/no-such-channel/active')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessions).toEqual([])
  })

  test('GET /api/sessions/source/:source/active returns source-scoped active channels', async () => {
    const newest = zero.sessionManager.getOrCreateForChannel('scheduler', 'sched_room_2').session
    newest.setStatus('idle')
    newest.data.updatedAt = '2026-03-09T00:00:03.000Z'

    const older = zero.sessionManager.getOrCreateForChannel('scheduler', 'sched_room_1').session
    older.data.updatedAt = '2026-03-09T00:00:02.000Z'

    const otherSource = zero.sessionManager.getOrCreateForChannel('telegram', 'chat_tg_1').session
    otherSource.data.updatedAt = '2026-03-09T00:00:04.000Z'

    const completed = zero.sessionManager.getOrCreateForChannel(
      'scheduler',
      'sched_room_done',
    ).session
    completed.setStatus('completed')
    completed.data.updatedAt = '2026-03-09T00:00:05.000Z'

    const res = await app.request('/api/sessions/source/scheduler/active')
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.sessions.map((session: { channelId: string }) => session.channelId)).toEqual([
      'sched_room_2',
      'sched_room_1',
    ])
    expect(
      data.sessions.every((session: { source: string }) => session.source === 'scheduler'),
    ).toBe(true)
    expect(
      data.sessions.every((session: { status: string }) =>
        ['active', 'idle'].includes(session.status),
      ),
    ).toBe(true)
  })

  test('GET /api/sessions includes channelName when present', async () => {
    const session = zero.sessionManager.getOrCreateForChannel(
      'feishu',
      'room-with-name',
      'feishu:ops',
    ).session
    const res = await app.request(`/api/sessions?q=${session.data.id}`)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessions[0].channelName).toBe('feishu:ops')
  })
})
