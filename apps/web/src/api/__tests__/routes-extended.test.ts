import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRoutes } from '../routes'
import { startZeroOS } from '../../../../server/src/main'
import type { ZeroOS } from '../../../../server/src/main'

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
      console.warn('[test] POST /api/chat returned 500 — upstream API unavailable, skipping assertions')
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
      console.warn('[test] POST /api/chat returned 500 — upstream API unavailable, skipping assertions')
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

  test('GET /api/sessions/channel/:channel/active returns active candidates only', async () => {
    const feishu = zero.sessionManager.getOrCreateForChannel('feishu', 'shared-room', 'feishu:ops').session
    feishu.data.updatedAt = '2026-03-08T00:00:02.000Z'

    const telegram = zero.sessionManager.getOrCreateForChannel('telegram', 'shared-room').session
    telegram.data.updatedAt = '2026-03-08T00:00:03.000Z'

    const feishuHr = zero.sessionManager.getOrCreateForChannel('feishu', 'shared-room', 'feishu:hr').session
    feishuHr.data.updatedAt = '2026-03-08T00:00:01.000Z'

    const web = zero.sessionManager.getOrCreateForChannel('web', 'shared-room').session
    web.setStatus('completed')
    web.data.updatedAt = '2026-03-08T00:00:04.000Z'

    const res = await app.request('/api/sessions/channel/shared-room/active')
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.sessions.map((session: { source: string; channelName?: string }) => `${session.source}:${session.channelName ?? 'none'}`)).toEqual([
      'telegram:none',
      'feishu:feishu:ops',
      'feishu:feishu:hr',
    ])
    expect(data.sessions.every((session: { status: string }) => ['active', 'idle'].includes(session.status))).toBe(true)
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

    const completed = zero.sessionManager.getOrCreateForChannel('scheduler', 'sched_room_done').session
    completed.setStatus('completed')
    completed.data.updatedAt = '2026-03-09T00:00:05.000Z'

    const res = await app.request('/api/sessions/source/scheduler/active')
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.sessions.map((session: { channelId: string }) => session.channelId)).toEqual([
      'sched_room_2',
      'sched_room_1',
    ])
    expect(data.sessions.every((session: { source: string }) => session.source === 'scheduler')).toBe(true)
    expect(data.sessions.every((session: { status: string }) => ['active', 'idle'].includes(session.status))).toBe(true)
  })

  test('GET /api/sessions includes channelName when present', async () => {
    const session = zero.sessionManager.getOrCreateForChannel('feishu', 'room-with-name', 'feishu:ops').session
    const res = await app.request(`/api/sessions?q=${session.data.id}`)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessions[0].channelName).toBe('feishu:ops')
  })
})
