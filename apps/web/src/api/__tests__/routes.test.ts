import { describe, test, expect, beforeAll } from 'bun:test'
import { createRoutes } from '../routes'
import { startZeroOS } from '../../../../server/src/main'
import type { ZeroOS } from '../../../../server/src/main'

let app: ReturnType<typeof createRoutes>
let zero: ZeroOS

beforeAll(async () => {
  zero = await startZeroOS()
  app = createRoutes(zero)
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
      body: JSON.stringify({ content: '# Memo\n\n## Goals\n- test goal\n\n## Needs User Action\n' }),
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
    expect(data.models.some((m: { name: string }) => m.name === 'openai-codex/gpt-5.4-medium')).toBe(true)
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
    expect(data.tools.length).toBe(10)
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

  test('POST /api/chat creates session and returns reply', async () => {
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What is 2+2?' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessionId).toBeDefined()
    expect(typeof data.reply).toBe('string')
    expect(data.reply.length).toBeGreaterThan(0)
  }, 60_000) // Real AI call may take time
})
