import type { Session as SessionData, SessionSource, SessionStatus, Message } from '@zero-os/shared'
import type { ModelRouter } from '@zero-os/model'
import type { ToolRegistry } from '../tool/registry'
import { Session, type SessionDeps } from './session'
import type { SessionDB, SessionRow, MetricsDB } from '@zero-os/observe'
import type { MemoryStore } from '@zero-os/memory'

/**
 * Manages all active sessions.
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map()
  private channelSessions: Map<string, string> = new Map()
  private modelRouter: ModelRouter
  private toolRegistry: ToolRegistry
  private deps: SessionDeps
  private sessionDb?: SessionDB

  constructor(modelRouter: ModelRouter, toolRegistry: ToolRegistry, deps: SessionDeps = {}, sessionDb?: SessionDB) {
    this.modelRouter = modelRouter
    this.toolRegistry = toolRegistry
    this.deps = deps
    this.sessionDb = sessionDb
  }

  /**
   * Create a new session.
   */
  create(source: SessionSource): Session {
    const session = new Session(source, this.modelRouter, this.toolRegistry, this.deps)
    this.sessions.set(session.data.id, session)
    return session
  }

  /**
   * Get a session by ID.
   */
  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  /**
   * List all active sessions.
   */
  listActive(): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.getStatus() === 'active' || s.getStatus() === 'idle'
    )
  }

  /**
   * List all sessions.
   */
  listAll(): Session[] {
    return Array.from(this.sessions.values())
  }

  private getChannelSessionKey(source: SessionSource, channelId: string, channelName?: string): string {
    return `${source}:${channelName ?? source}:${channelId}`
  }

  /**
   * Get or create a session bound to a channel conversation.
   * Reuses an existing active/idle session for the same (source, channelId) pair.
   */
  getOrCreateForChannel(
    source: SessionSource,
    channelId: string,
    channelName?: string
  ): { session: Session; isNew: boolean } {
    const key = this.getChannelSessionKey(source, channelId, channelName)
    const existingId = this.channelSessions.get(key)
    if (existingId) {
      const session = this.sessions.get(existingId)
      if (session && session.getStatus() !== 'completed' && session.getStatus() !== 'archived') {
        return { session, isNew: false }
      }
      this.channelSessions.delete(key)
    }
    const session = this.create(source)
    session.data.channelName = channelName
    session.data.channelId = channelId
    this.channelSessions.set(key, session.data.id)
    return { session, isNew: true }
  }

  /**
   * Force-create a new session for a channel conversation and rebind mapping.
   * Keeps the previous session in memory/history and marks it completed by default.
   */
  startNewForChannel(
    source: SessionSource,
    channelId: string,
    channelNameOrOptions?: string | { channelName?: string; previousStatus?: 'completed' | 'archived' },
    maybeOptions?: { previousStatus?: 'completed' | 'archived' }
  ): { session: Session; previousSessionId?: string } {
    const channelName = typeof channelNameOrOptions === 'string'
      ? channelNameOrOptions
      : channelNameOrOptions?.channelName
    const options = typeof channelNameOrOptions === 'string'
      ? maybeOptions
      : channelNameOrOptions
    const key = this.getChannelSessionKey(source, channelId, channelName)
    const previousSessionId = this.channelSessions.get(key)
    const previousStatus = options?.previousStatus ?? 'completed'

    if (previousSessionId) {
      const previous = this.sessions.get(previousSessionId)
      const status = previous?.getStatus()
      if (previous && (status === 'active' || status === 'idle')) {
        previous.setStatus(previousStatus)
      }
    }

    const session = this.create(source)
    session.data.channelName = channelName
    session.data.channelId = channelId
    this.channelSessions.set(key, session.data.id)
    return { session, previousSessionId }
  }

  /**
   * Remove a completed session from active tracking.
   */
  remove(id: string): void {
    const session = this.sessions.get(id)
    if (session?.data.channelId) {
      const key = this.getChannelSessionKey(
        session.data.source,
        session.data.channelId,
        session.data.channelName,
      )
      if (this.channelSessions.get(key) === id) {
        this.channelSessions.delete(key)
      }
    }
    this.sessions.delete(id)
  }

  // --- Persistence methods ---

  /**
   * Restore active/idle sessions from the database on startup.
   * Returns the number of sessions restored.
   */
  restoreFromDB(): number {
    if (!this.sessionDb) return 0

    const rows = this.sessionDb.loadActiveSessions()
    let restored = 0

    for (const row of rows) {
      const data: SessionData = {
        id: row.id,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        source: row.source,
        status: row.status,
        currentModel: row.currentModel,
        modelHistory: row.modelHistory,
        summary: row.summary,
        tags: row.tags,
        channelName: row.channelName,
        channelId: row.channelId,
      }

      const messages = this.sessionDb.loadSessionMessages(row.id)
      const session = Session.restore(data, messages, this.modelRouter, this.toolRegistry, this.deps, row.systemPrompt)

      // Re-initialize agent if config was saved
      if (row.agentConfigJson) {
        try {
          const agentConfig = JSON.parse(row.agentConfigJson)
          session.initAgent(agentConfig)
        } catch {
          // If agent config is invalid, skip re-init — session still usable
        }
      }

      this.sessions.set(session.data.id, session)

      // Restore channel mapping
      if (row.channelId) {
        this.channelSessions.set(
          this.getChannelSessionKey(row.source, row.channelId, row.channelName),
          row.id,
        )
      }

      restored++
    }

    return restored
  }

  /**
   * Flush all in-memory sessions to DB (for graceful shutdown).
   */
  flushAll(): void {
    if (!this.sessionDb) return
    for (const [id, session] of this.sessions) {
      const agentConfig = session.getAgentConfig()
      this.sessionDb.saveSession(
        session.data,
        agentConfig ? JSON.stringify(agentConfig) : undefined,
        session.getSystemPrompt() || undefined
      )
      this.sessionDb.saveMessages(id, session.getMessages())
    }
  }

  /**
   * Permanently delete a session and all associated data.
   */
  deleteSession(id: string, memoryStore?: MemoryStore, metrics?: MetricsDB): boolean {
    this.remove(id)
    const dbDeleted = this.sessionDb?.deleteSession(id) ?? false
    metrics?.deleteSessionMetrics(id)
    memoryStore?.deleteBySessionId(id)
    return dbDeleted
  }

  // --- DB query proxies (for API routes to access historical sessions) ---

  getFromDB(id: string): SessionRow | null {
    return this.sessionDb?.getSession(id) ?? null
  }

  getMessagesFromDB(id: string): Message[] {
    return this.sessionDb?.loadSessionMessages(id) ?? []
  }

  listAllFromDB(filter?: { status?: SessionStatus; limit?: number; offset?: number }): SessionRow[] {
    return this.sessionDb?.loadAllSessions(filter) ?? []
  }
}
