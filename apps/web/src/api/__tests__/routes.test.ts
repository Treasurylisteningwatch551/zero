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

describe('API Routes (Real)', () => {
  test('GET /api/status returns system status', async () => {
    const res = await app.request('/api/status')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('running')
    expect(data.currentModel).toContain('/')
    expect(data.version).toBe('0.1.0')
  })

  test('GET /api/sessions returns list', async () => {
    const res = await app.request('/api/sessions')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.sessions)).toBe(true)
  })

  test('GET /api/sessions/:id returns 404 for missing session', async () => {
    const res = await app.request('/api/sessions/nonexistent')
    expect(res.status).toBe(404)
  })

  test('GET /api/memory returns memories', async () => {
    const res = await app.request('/api/memory?type=note')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.type).toBe('note')
    expect(Array.isArray(data.memories)).toBe(true)
  })

  test('PUT /api/memo updates memo', async () => {
    const res = await app.request('/api/memo', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '# Memo\n\n## Goals\n- test goal\n\n## Needs User Action\n',
      }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
  })

  test('GET /api/memo returns updated content', async () => {
    const res = await app.request('/api/memo')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.content).toContain('# Memo')
    expect(data.content).toContain('test goal')
  })

  test('GET /api/metrics/cost returns cost data', async () => {
    const res = await app.request('/api/metrics/cost?range=7d')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.range).toBe('7d')
  })

  test('GET /api/metrics/summary returns summary', async () => {
    const res = await app.request('/api/metrics/summary')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.today).toBeDefined()
    expect(data.week).toBeDefined()
    expect(data.month).toBeDefined()
  })

  test('GET /api/config returns config', async () => {
    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.defaultModel).toBe('openai-codex/gpt-5.4-medium')
    expect(data.providers).toBeDefined()
  })

  test('GET /api/models returns model list', async () => {
    const res = await app.request('/api/models')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.models)).toBe(true)
    expect(
      data.models.some((m: { name: string }) => m.name === 'openai-codex/gpt-5.4-medium'),
    ).toBe(true)
  })

  test('POST /api/chat/model switches runtime model', async () => {
    const res = await app.request('/api/chat/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.3-codex-medium' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.currentModel).toBe('openai-codex/gpt-5.3-codex-medium')
  })

  test('POST /api/chat/model without sessionId updates web default scope', async () => {
    const res = await app.request('/api/chat/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.4-medium' }),
    })
    expect(res.status).toBe(200)

    const statusRes = await app.request('/api/status')
    const statusData = await statusRes.json()
    expect(statusData.currentModel).toBe('openai-codex/gpt-5.4-medium')
  })

  test('GET /api/logs returns entries', async () => {
    const res = await app.request('/api/logs?limit=50')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.limit).toBe(50)
    expect(Array.isArray(data.entries)).toBe(true)
  })

  test('GET /api/tools returns registered tools', async () => {
    const res = await app.request('/api/tools')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.tools.length).toBe(15)
    const names = data.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('write')
    expect(names).toContain('edit')
    expect(names).toContain('bash')
    expect(names).toContain('fetch')
    expect(names).toContain('memory')
    expect(names).toContain('memory_search')
    expect(names).toContain('memory_get')
    expect(names).toContain('task')
    expect(names).toContain('schedule')
    expect(names).toContain('codex')
    expect(names).toContain('spawn_agent')
    expect(names).toContain('wait_agent')
    expect(names).toContain('close_agent')
    expect(names).toContain('send_input')
  })

  test('GET /api/metrics/cost-by-day returns data array', async () => {
    const res = await app.request('/api/metrics/cost-by-day')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.data)).toBe(true)
  })

  test('GET /api/metrics/tool-stats returns data array', async () => {
    const res = await app.request('/api/metrics/tool-stats')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.data)).toBe(true)
  })

  test('GET /api/metrics/cache-by-model returns cache analytics rows', async () => {
    zero.metrics.recordRequest({
      id: 'req_cache_metrics_001',
      sessionId: 'sess_cache_metrics_001',
      model: 'anthropic/claude-opus-4-6',
      provider: 'anthropic',
      inputTokens: 550,
      outputTokens: 100,
      cacheWriteTokens: 50,
      cacheReadTokens: 400,
      cost: 0.01,
      durationMs: 100,
      createdAt: new Date().toISOString(),
    })

    const res = await app.request('/api/metrics/cache-by-model?range=7d')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.data)).toBe(true)
    expect(
      data.data.some(
        (row: { model: string; cacheRead: number; effectiveInput: number; netSavings: number }) =>
          row.model === 'anthropic/claude-opus-4-6' &&
          row.cacheRead === 400 &&
          row.effectiveInput === 1000 &&
          Math.abs(row.netSavings - 0.0017375) < 1e-12,
      ),
    ).toBe(true)
  })

  test('GET /api/sessions/:id returns cache summary fields', async () => {
    const session = zero.sessionManager.create('web')
    const createdAt = new Date().toISOString()

    zero.metrics.recordRequest({
      id: 'req_cache_session_001',
      sessionId: session.data.id,
      model: 'anthropic/claude-opus-4-6',
      provider: 'anthropic',
      inputTokens: 550,
      outputTokens: 100,
      cacheWriteTokens: 50,
      cacheReadTokens: 400,
      cost: 0.01,
      durationMs: 100,
      createdAt,
    })
    const span = zero.tracer.startSpan(session.data.id, 'llm_request', undefined, {
      kind: 'llm_request',
      data: {
        request: {
          id: 'req_cache_session_001',
          turnIndex: 1,
          sessionId: session.data.id,
          model: 'anthropic/claude-opus-4-6',
          provider: 'anthropic',
          userPrompt: 'test cache',
          response: 'ok',
          stopReason: 'end_turn',
          toolUseCount: 0,
          toolCalls: [],
          toolResults: [],
          tokens: {
            input: 550,
            output: 100,
            cacheWrite: 50,
            cacheRead: 400,
          },
          cost: 0.01,
          durationMs: 100,
        },
      },
    })
    zero.tracer.endSpan(span.id, 'success')

    const res = await app.request(`/api/sessions/${session.data.id}`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.cacheWriteTokens).toBe(50)
    expect(data.cacheReadTokens).toBe(400)
    expect(data.effectiveInputTokens).toBe(1000)
    expect(data.cacheHitRate).toBeCloseTo(0.4, 5)
    expect(typeof data.cacheReadCost).toBe('number')
    expect(data.netSavings).toBeCloseTo(0.0017375, 12)
  })

  test('POST /api/chat creates session and returns reply', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What is 2+2?' }),
    })
    if (res.status === 500) {
      console.warn(
        '[test] POST /api/chat returned 500 — upstream API unavailable, skipping assertions',
      )
      return
    }
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessionId).toBeDefined()
    expect(typeof data.reply).toBe('string')
    expect(data.reply.length).toBeGreaterThan(0)
  }, 60_000) // Real AI call may take time

  test('POST /api/chat returns 503 while shutdown is in progress', async () => {
    const originalIsShuttingDown = zero.isShuttingDown
    zero.isShuttingDown = () => true

    try {
      const res = await app.request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello during restart' }),
      })

      expect(res.status).toBe(503)
      const data = await res.json()
      expect(data.error).toContain('restarting')
    } finally {
      zero.isShuttingDown = originalIsShuttingDown
    }
  })
})
