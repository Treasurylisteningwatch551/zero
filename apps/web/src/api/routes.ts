import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ZeroOS } from '../../../server/src/main'
import { MemoryRetriever } from '@zero-os/memory'
import type { MemoryType, SessionStatus } from '@zero-os/shared'
import type { SessionRow } from '@zero-os/observe'
import { GitOps } from '@zero-os/supervisor'

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

      // In-memory sessions (active runtime)
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

      const result: Array<Record<string, unknown>> = sessions.map((s) => {
        const msgs = s.getMessages()
        const toolCallCount = msgs
          .flatMap((m) => m.content)
          .filter((b) => b.type === 'tool_use').length
        const stats = statsBatch.get(s.data.id)

        return {
          id: s.data.id,
          source: s.data.source,
          channelName: s.data.channelName,
          status: s.getStatus(),
          currentModel: s.data.currentModel,
          createdAt: s.data.createdAt,
          updatedAt: s.data.updatedAt,
          messageCount: msgs.length,
          tags: s.data.tags,
          summary: s.data.summary,
          channelId: s.data.channelId,
          modelHistory: s.data.modelHistory,
          toolCallCount,
          totalTokens: stats?.totalTokens ?? 0,
          totalCost: stats?.totalCost ?? 0,
        }
      })

      // Merge DB-only sessions for non-active filters
      if (filter !== 'active') {
        const inMemoryIds = new Set(sessionIds)
        const dbFilter = filter === 'completed' || filter === 'archived'
          ? { status: filter as SessionStatus }
          : undefined
        const dbRows = zero.sessionManager.listAllFromDB(dbFilter)
        const dbOnlyIds = dbRows.filter((r) => !inMemoryIds.has(r.id)).map((r) => r.id)
        const dbStatsBatch = dbOnlyIds.length > 0
          ? zero.metrics.sessionStatsBatch(dbOnlyIds)
          : new Map()

        for (const row of dbRows) {
          if (inMemoryIds.has(row.id)) continue
          const stats = dbStatsBatch.get(row.id)
          result.push({
            id: row.id,
            source: row.source,
            channelName: row.channelName,
            status: row.status,
            currentModel: row.currentModel,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            messageCount: 0,
            tags: row.tags,
            summary: row.summary,
            channelId: row.channelId,
            modelHistory: row.modelHistory,
            toolCallCount: 0,
            totalTokens: stats?.totalTokens ?? 0,
            totalCost: stats?.totalCost ?? 0,
          })
        }
      }

      const filtered = q
        ? result.filter((s) =>
            (s.id as string).toLowerCase().includes(q) ||
            (s.source as string).toLowerCase().includes(q) ||
            ((s.channelName as string)?.toLowerCase().includes(q) ?? false) ||
            (s.currentModel as string).toLowerCase().includes(q) ||
            ((s.summary as string)?.toLowerCase().includes(q) ?? false) ||
            ((s.channelId as string)?.toLowerCase().includes(q) ?? false)
          )
        : result

      return c.json({ sessions: filtered })
    })

    .get('/api/sessions/channel/:channel/active', (c) => {
      const channel = c.req.param('channel')

      const sessions = zero.sessionManager
        .listActive()
        .filter((session) => session.data.channelId === channel)
        .sort((left, right) => right.data.updatedAt.localeCompare(left.data.updatedAt))
        .map((session) => ({
          id: session.data.id,
          source: session.data.source,
          channelName: session.data.channelName,
          channelId: session.data.channelId ?? channel,
          status: session.getStatus(),
          updatedAt: session.data.updatedAt,
          summary: session.data.summary,
        }))

      return c.json({ sessions })
    })

    .get('/api/sessions/source/:source/active', (c) => {
      const source = c.req.param('source')

      const sessions = zero.sessionManager
        .listActive()
        .filter((session) => session.data.source === source && session.data.channelId)
        .sort((left, right) => right.data.updatedAt.localeCompare(left.data.updatedAt))
        .map((session) => ({
          id: session.data.id,
          source: session.data.source,
          channelName: session.data.channelName,
          channelId: session.data.channelId as string,
          status: session.getStatus(),
          updatedAt: session.data.updatedAt,
          summary: session.data.summary,
        }))

      return c.json({ sessions })
    })

    .get('/api/sessions/:id', (c) => {
      const id = c.req.param('id')
      const session = zero.sessionManager.get(id)
      if (session) {
        const stats = zero.metrics.sessionStats(id)
        return c.json({
          id: session.data.id,
          source: session.data.source,
          channelName: session.data.channelName,
          channelId: session.data.channelId,
          status: session.getStatus(),
          currentModel: session.data.currentModel,
          createdAt: session.data.createdAt,
          updatedAt: session.data.updatedAt,
          messages: session.getMessages(),
          tags: session.data.tags,
          summary: session.data.summary,
          modelHistory: session.data.modelHistory,
          systemPrompt: session.getSystemPrompt() || undefined,
          totalTokens: stats.totalTokens,
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          totalCost: stats.totalCost,
          requestCount: stats.requestCount,
        })
      }

      // Fallback to DB for historical sessions
      const row = zero.sessionManager.getFromDB(id)
      if (!row) {
        return c.json({ error: 'Session not found' }, 404)
      }
      const messages = zero.sessionManager.getMessagesFromDB(id)
      const stats = zero.metrics.sessionStats(id)
      return c.json({
        id: row.id,
        source: row.source,
        channelName: row.channelName,
        channelId: row.channelId,
        status: row.status,
        currentModel: row.currentModel,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        messages,
        tags: row.tags,
        summary: row.summary,
        modelHistory: row.modelHistory,
        systemPrompt: row.systemPrompt,
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

    .get('/api/sessions/:id/task-closure-events', (c) => {
      const id = c.req.param('id')
      const entries = zero.logger
        .readEntries<Record<string, unknown>>('operations.jsonl')
        .filter((entry) => {
          const sessionId = (entry.sessionId as string | undefined) ?? (entry.session_id as string | undefined)
          const event = entry.event as string | undefined
          return sessionId === id && (
            event === 'task_closure_decision' ||
            event === 'task_closure_skipped' ||
            event === 'task_closure_trim_failed'
          )
        })
        .sort((left, right) => String(left.ts ?? '').localeCompare(String(right.ts ?? '')))

      return c.json({ events: entries })
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

    .delete('/api/sessions/:id', (c) => {
      const id = c.req.param('id')
      const deleted = zero.sessionManager.deleteSession(id, zero.memoryStore, zero.metrics)
      if (!deleted) {
        return c.json({ error: 'Session not found' }, 404)
      }
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

    .post('/api/memory', async (c) => {
      const body = await c.req.json<{
        type: MemoryType
        title: string
        content: string
        tags?: string[]
        status?: string
        confidence?: number
      }>()
      if (!body.type || !body.title || !body.content) {
        return c.json({ error: 'type, title, and content are required' }, 400)
      }
      const memory = zero.memoryStore.create(body.type, body.title, body.content, {
        tags: body.tags ?? [],
        status: body.status ?? 'draft',
        confidence: body.confidence ?? 0.5,
      })
      return c.json({ memory })
    })

    .get('/api/memory/:type/:id', (c) => {
      const type = c.req.param('type') as MemoryType
      const id = c.req.param('id')
      const memory = zero.memoryStore.get(type, id)
      if (!memory) return c.json({ error: 'Memory not found' }, 404)
      return c.json({ memory })
    })

    .put('/api/memory/:type/:id', async (c) => {
      const type = c.req.param('type') as MemoryType
      const id = c.req.param('id')
      const body = await c.req.json<Record<string, unknown>>()
      const updated = zero.memoryStore.update(type, id, body)
      if (!updated) return c.json({ error: 'Memory not found' }, 404)
      return c.json({ memory: updated })
    })

    .delete('/api/memory/:type/:id', (c) => {
      const type = c.req.param('type') as MemoryType
      const id = c.req.param('id')
      const deleted = zero.memoryStore.delete(type, id)
      if (!deleted) return c.json({ error: 'Memory not found' }, 404)
      return c.json({ ok: true })
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

    .get('/api/metrics/cache-hit-rate', (c) => {
      const range = c.req.query('range') ?? '30d'
      const data = zero.metrics.cacheHitRate(range)
      return c.json({ data })
    })

    .get('/api/metrics/task-success-rate', (c) => {
      const range = c.req.query('range') ?? '30d'
      const data = zero.metrics.taskSuccessRate(range)
      return c.json({ data })
    })

    .get('/api/metrics/health', (c) => {
      const range = c.req.query('range') ?? '30d'
      const repairs = zero.metrics.repairStats(range)
      const repairTrend = zero.metrics.repairByDay(range)
      return c.json({ repairs, repairTrend })
    })

    .get('/api/metrics/cost-by-day-model', (c) => {
      const range = c.req.query('range') ?? '30d'
      const data = zero.metrics.costByDayModel(range)
      return c.json({ data })
    })

    .get('/api/metrics/avg-duration', (c) => {
      const range = c.req.query('range') ?? '30d'
      const data = zero.metrics.avgDurationByDay(range)
      return c.json({ data })
    })

    .get('/api/metrics/cost-detail', (c) => {
      const range = c.req.query('range') ?? '30d'
      const data = zero.metrics.costDetailRecords(range)
      return c.json({ data })
    })

    .get('/api/metrics/tool-error-by-day', (c) => {
      const range = c.req.query('range') ?? '30d'
      const data = zero.metrics.toolErrorByDay(range)
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

    // Notifications — return from notification store, fallback to log-based
    .get('/api/notifications', (c) => {
      if (zero.notifications.length > 0) {
        const active = zero.notifications
          .filter((n) => !n.dismissedAt)
          .slice(-50)
          .reverse()
        return c.json({ notifications: active })
      }

      // Fallback: derive from log entries
      const entries = zero.logger.readEntries<Record<string, unknown>>('operations.jsonl')
      const notifications = entries
        .filter((e) => e.level === 'warn' || e.level === 'error')
        .slice(-50)
        .reverse()
        .map((e) => ({
          id: crypto.randomUUID(),
          type: 'system' as const,
          severity: (e.level as string) === 'error' ? 'error' as const : 'warn' as const,
          title: (e.event as string) ?? 'System Event',
          description: (e.event as string) ?? (e.outputSummary as string) ?? 'Unknown event',
          source: (e.tool as string) ?? (e.event as string) ?? 'system',
          sessionId: (e.sessionId as string) ?? (e.session_id as string) ?? undefined,
          actionable: false,
          createdAt: e.ts as string,
          // Legacy compat fields
          ts: e.ts as string,
          level: e.level as string,
        }))
      return c.json({ notifications })
    })

    .post('/api/notifications/:id/dismiss', (c) => {
      const id = c.req.param('id')
      const notification = zero.notifications.find((n) => n.id === id)
      if (!notification) {
        return c.json({ error: 'Notification not found' }, 404)
      }
      notification.dismissedAt = new Date().toISOString()
      return c.json({ ok: true })
    })

    // Channel status — real data from channel registry
    .get('/api/channels/status', (c) => {
      const channels = Array.from(zero.channels.entries()).map(([name, ch]) => ({
        name,
        type: ch.type,
        status: ch.isConnected() ? 'online' : 'offline',
      }))
      return c.json({ channels })
    })

    // Channel config — detailed configuration info
    .get('/api/channels/config', (c) => {
      const channelConfigs = Array.from(zero.channels.entries()).map(([name, ch]) => {
        const keys = zero.channelDefinitions.get(name)?.secretRefs ?? []
        const secrets = keys.map((k) => ({
          key: k,
          configured: !!zero.vault.get(k),
        }))

        return {
          name,
          type: ch.type,
          status: ch.isConnected() ? 'online' : 'offline',
          secrets,
          codePath: `packages/channel/src/${ch.type}/`,
        }
      })
      return c.json({ channels: channelConfigs })
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

    // Secrets management
    .post('/api/config/secrets', async (c) => {
      const body = await c.req.json<{ key: string; value: string }>()
      if (!body.key || !body.value) {
        return c.json({ error: 'key and value are required' }, 400)
      }
      zero.vault.set(body.key, body.value)
      return c.json({ ok: true, key: body.key })
    })

    .post('/api/config/secrets/delete', async (c) => {
      const body = await c.req.json<{ key: string }>()
      if (!body.key) {
        return c.json({ error: 'key is required' }, 400)
      }
      zero.vault.delete(body.key)
      return c.json({ ok: true, key: body.key })
    })

    // Git rollback
    .post('/api/config/rollback', async (c) => {
      const gitOps = new GitOps(process.cwd())
      const lastTag = await gitOps.getLastStableTag()
      if (!lastTag) {
        return c.json({ error: 'No stable tag found to rollback to' }, 404)
      }
      await gitOps.rollbackToTag(lastTag)
      return c.json({ ok: true, rolledBackTo: lastTag })
    })

    // Git last stable tag
    .get('/api/config/last-stable-tag', async (c) => {
      const gitOps = new GitOps(process.cwd())
      const tag = await gitOps.getLastStableTag()
      return c.json({ tag })
    })

  return app
}

export type AppType = ReturnType<typeof createRoutes>
