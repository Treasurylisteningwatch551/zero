import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ZeroOS } from '../../../server/src/main'
import { MemoryRetriever } from '@zero-os/memory'
import type { MemoryType } from '@zero-os/shared'

export function createRoutes(zero: ZeroOS) {
  const retriever = new MemoryRetriever(zero.memoryStore)

  const app = new Hono()
    .use('*', cors())

    // System status
    .get('/api/status', (c) => {
      const current = zero.modelRouter.getCurrentModel()
      const activeSessions = zero.sessionManager.listActive()
      return c.json({
        status: 'running',
        uptime: process.uptime(),
        currentModel: current?.modelName ?? 'unknown',
        version: '0.1.0',
        heartbeatAge: 3,
        activeSessions: activeSessions.length,
      })
    })

    // Sessions
    .get('/api/sessions', (c) => {
      const filter = c.req.query('filter') ?? 'all'
      const q = c.req.query('q')?.toLowerCase() ?? ''

      let sessions = filter === 'active'
        ? zero.sessionManager.listActive()
        : zero.sessionManager.listAll()

      if (filter === 'completed') {
        sessions = sessions.filter((s) => s.getStatus() === 'completed')
      } else if (filter === 'archived') {
        sessions = sessions.filter((s) => s.getStatus() === 'archived')
      }

      const sessionIds = sessions.map((s) => s.data.id)
      const statsBatch = zero.metrics.sessionStatsBatch(sessionIds)

      const result = sessions.map((s) => {
        const msgs = s.getMessages()
        const toolCallCount = msgs
          .flatMap((m) => m.content)
          .filter((b) => b.type === 'tool_use').length
        const stats = statsBatch.get(s.data.id)

        return {
          id: s.data.id,
          source: s.data.source,
          status: s.getStatus(),
          currentModel: s.data.currentModel,
          createdAt: s.data.createdAt,
          updatedAt: s.data.updatedAt,
          messageCount: msgs.length,
          tags: s.data.tags,
          summary: s.data.summary,
          modelHistory: s.data.modelHistory,
          toolCallCount,
          totalTokens: stats?.totalTokens ?? 0,
          totalCost: stats?.totalCost ?? 0,
        }
      })

      const filtered = q
        ? result.filter((s) =>
            s.id.toLowerCase().includes(q) ||
            s.source.toLowerCase().includes(q) ||
            s.currentModel.toLowerCase().includes(q) ||
            (s.summary?.toLowerCase().includes(q) ?? false)
          )
        : result

      return c.json({ sessions: filtered })
    })

    .get('/api/sessions/:id', (c) => {
      const id = c.req.param('id')
      const session = zero.sessionManager.get(id)
      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }
      const stats = zero.metrics.sessionStats(id)
      return c.json({
        id: session.data.id,
        source: session.data.source,
        status: session.getStatus(),
        currentModel: session.data.currentModel,
        createdAt: session.data.createdAt,
        updatedAt: session.data.updatedAt,
        messages: session.getMessages(),
        tags: session.data.tags,
        summary: session.data.summary,
        modelHistory: session.data.modelHistory,
        totalTokens: stats.totalTokens,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        totalCost: stats.totalCost,
        requestCount: stats.requestCount,
      })
    })

    .get('/api/sessions/:id/traces', (c) => {
      const id = c.req.param('id')
      const traces = zero.tracer.exportSession(id)
      return c.json({ traces })
    })

    .post('/api/sessions/:id/archive', (c) => {
      const id = c.req.param('id')
      const session = zero.sessionManager.get(id)
      if (!session) {
        return c.json({ error: 'Session not found' }, 404)
      }
      session.setStatus('archived')
      return c.json({ ok: true })
    })

    // Chat — create session + send message to AI
    .post('/api/chat', async (c) => {
      const body = await c.req.json<{ message: string; sessionId?: string }>()

      let session = body.sessionId
        ? zero.sessionManager.get(body.sessionId)
        : undefined

      if (!session) {
        session = zero.sessionManager.create('web')
        session.initAgent({
          name: 'zero-web',
          systemPrompt: 'You are ZeRo OS, an AI agent system running on macOS. Be helpful, concise, and accurate.',
        })
      }

      const newMessages = await session.handleMessage(body.message)

      // Extract the assistant reply text
      const assistantMessages = newMessages.filter((m) => m.role === 'assistant')
      const replyText = assistantMessages
        .flatMap((m) => m.content)
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n')

      return c.json({
        sessionId: session.data.id,
        reply: replyText,
        messages: newMessages,
      })
    })

    // Memory
    .get('/api/memory', (c) => {
      const type = c.req.query('type') as MemoryType | undefined
      if (type && type !== 'all' as unknown) {
        const memories = zero.memoryStore.list(type)
        return c.json({ memories, type })
      }
      // List all types
      const allTypes: MemoryType[] = ['session', 'incident', 'runbook', 'decision', 'note']
      const memories = allTypes.flatMap((t) => zero.memoryStore.list(t))
      memories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return c.json({ memories, type: 'all' })
    })

    .get('/api/memory/search', async (c) => {
      const q = c.req.query('q') ?? ''
      if (!q) return c.json({ results: [], query: q })
      const results = await retriever.retrieve(q, { topN: 20, confidenceThreshold: 0 })
      return c.json({ results, query: q })
    })

    // Memo
    .get('/api/memo', (c) => {
      const content = zero.memoManager.read()
      return c.json({ content })
    })

    .put('/api/memo', async (c) => {
      const body = await c.req.json<{ content: string }>()
      await zero.memoManager.write(body.content)
      return c.json({ ok: true, length: body.content.length })
    })

    // Metrics
    .get('/api/metrics/cost', (c) => {
      const range = c.req.query('range') ?? '7d'
      const byModel = zero.metrics.costByModel(range)
      const totalCost = byModel.reduce((sum, m) => sum + m.totalCost, 0)
      const totalTokens = byModel.reduce((sum, m) => sum + m.totalInput + m.totalOutput, 0)
      return c.json({ range, totalCost, totalTokens, byModel })
    })

    .get('/api/metrics/summary', (c) => {
      const today = zero.metrics.summary('1d')
      const week = zero.metrics.summary('7d')
      const month = zero.metrics.summary('30d')
      return c.json({
        today: { cost: today.totalCost, tokens: today.totalTokens },
        week: { cost: week.totalCost, tokens: week.totalTokens },
        month: { cost: month.totalCost, tokens: month.totalTokens },
      })
    })

    .get('/api/metrics/cost-by-day', (c) => {
      const range = c.req.query('range') ?? '30d'
      const data = zero.metrics.costByDay(range)
      return c.json({ data })
    })

    .get('/api/metrics/tool-stats', (c) => {
      const range = c.req.query('range') ?? '7d'
      const data = zero.metrics.toolStats(range)
      return c.json({ data })
    })

    // Config
    .get('/api/config', (c) => {
      return c.json({
        providers: zero.config.providers,
        defaultModel: zero.config.defaultModel,
        fallbackChain: zero.config.fallbackChain,
        schedules: zero.config.schedules,
        fuseList: zero.config.fuseList,
      })
    })

    // Logs
    .get('/api/logs', (c) => {
      const limit = Number(c.req.query('limit') ?? '100')
      const level = c.req.query('level')
      const type = c.req.query('type') ?? 'operations'
      const since = c.req.query('since')

      // Trace type uses Tracer, not JSONL files
      if (type === 'trace') {
        const allSessions = zero.sessionManager.listAll()
        const traceEntries = allSessions.flatMap((s) => {
          const traces = zero.tracer.exportSession(s.data.id)
          return traces.map((t) => ({
            ts: t.startTime,
            sessionId: s.data.id,
            name: t.name,
            status: t.status,
            durationMs: t.durationMs,
            childCount: t.children.length,
          }))
        })
        traceEntries.sort((a, b) => b.ts.localeCompare(a.ts))
        return c.json({ entries: traceEntries.slice(0, limit), limit })
      }

      const file = type === 'requests' ? 'requests.jsonl'
        : type === 'snapshots' ? 'snapshots.jsonl'
        : 'operations.jsonl'

      let entries = zero.logger.readEntries<Record<string, unknown>>(file)

      if (level && level !== 'all') {
        entries = entries.filter((e) => e.level === level)
      }

      if (since) {
        entries = entries.filter((e) => typeof e.ts === 'string' && e.ts >= since)
      }

      // Most recent first, limit
      entries.reverse()
      entries = entries.slice(0, limit)

      return c.json({ entries, limit })
    })

    // Tools
    .get('/api/tools', (c) => {
      const tools = zero.toolRegistry.list().map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))
      return c.json({ tools })
    })

  return app
}

export type AppType = ReturnType<typeof createRoutes>
