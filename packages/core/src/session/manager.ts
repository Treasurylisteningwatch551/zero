import type { Session as SessionData, SessionSource, SessionStatus, Message } from '@zero-os/shared'
import type { ModelRouter } from '@zero-os/model'
import type { ToolRegistry } from '../tool/registry'
import { Session, type SessionDeps } from './session'
import type { SessionDB, SessionRow, MetricsDB } from '@zero-os/observe'
import type { MemoryStore } from '@zero-os/memory'

interface SessionCreateOptions {
  channelId?: string
  channelName?: string
  initialModel?: string
  modelScope?: {
    channelId: string
    channelName?: string
  }
}

/**
 * Manages all active sessions.
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map()
  private channelSessions: Map<string, string> = new Map()
  private channelModelPreferences: Map<string, string> = new Map()
  private modelRouter: ModelRouter
  private toolRegistry: ToolRegistry
  private deps: SessionDeps
  private sessionDb?: SessionDB

  constructor(modelRouter: ModelRouter, toolRegistry: ToolRegistry, deps: SessionDeps = {}, sessionDb?: SessionDB) {
    this.modelRouter = modelRouter
    this.toolRegistry = toolRegistry
    this.deps = deps
    this.sessionDb = sessionDb
    this.loadChannelModelPreferences()
  }

  /**
   * Create a new session.
   */
  create(source: SessionSource, options: SessionCreateOptions = {}): Session {
    const modelScope = options.modelScope ?? this.getDefaultModelScope(source)
    const initialModel = options.initialModel ?? this.getPreferredModel(source, modelScope?.channelId, modelScope?.channelName)
    const sessionDeps = this.createSessionDeps(source, modelScope)
    const session = new Session(source, this.modelRouter, this.toolRegistry, sessionDeps, initialModel)

    if (options.channelName) {
      session.data.channelName = options.channelName
    }
    if (options.channelId) {
      session.data.channelId = options.channelId
    }

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

  getPreferredModel(source: SessionSource, channelId?: string, channelName?: string): string {
    const scope = this.getModelScope(source, channelId, channelName)
    if (scope) {
      const key = this.getChannelSessionKey(source, scope.channelId, scope.channelName)
      const preferred = this.channelModelPreferences.get(key)
      if (preferred) return preferred
    }

    return this.modelRouter.getDefaultModelLabel()
  }

  setPreferredModel(source: SessionSource, channelId: string, model: string, channelName?: string): string {
    const normalized = this.modelRouter.normalizeModelReference(model) ?? model
    const key = this.getChannelSessionKey(source, channelId, channelName)
    this.channelModelPreferences.set(key, normalized)
    this.sessionDb?.saveChannelModel(source, channelId, normalized, channelName)
    return normalized
  }

  private createSessionDeps(
    source: SessionSource,
    modelScope?: { channelId: string; channelName?: string }
  ): SessionDeps {
    if (!modelScope) return this.deps

    return {
      ...this.deps,
      persistModelPreference: (model: string) => {
        this.setPreferredModel(source, modelScope.channelId, model, modelScope.channelName)
      },
    }
  }

  private getDefaultModelScope(source: SessionSource): { channelId: string; channelName?: string } | undefined {
    if (source === 'web') {
      return { channelId: 'default', channelName: 'web' }
    }
    return undefined
  }

  private getModelScope(
    source: SessionSource,
    channelId?: string,
    channelName?: string
  ): { channelId: string; channelName?: string } | undefined {
    if (channelId) {
      return { channelId, channelName }
    }
    return this.getDefaultModelScope(source)
  }

  private loadChannelModelPreferences(): void {
    if (!this.sessionDb) return

    for (const row of this.sessionDb.loadChannelModels()) {
      const normalized = this.modelRouter.normalizeModelReference(row.model) ?? row.model
      const key = this.getChannelSessionKey(row.source, row.channelId, row.channelName)
      this.channelModelPreferences.set(key, normalized)
    }
  }

  private normalizeRow(row: SessionRow): SessionRow {
    return {
      ...row,
      currentModel: this.modelRouter.normalizeModelReference(row.currentModel) ?? row.currentModel,
      modelHistory: row.modelHistory.map((entry) => ({
        ...entry,
        model: this.modelRouter.normalizeModelReference(entry.model) ?? entry.model,
      })),
    }
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

    const session = this.create(source, {
      channelId,
      channelName,
      modelScope: { channelId, channelName },
    })
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

    const session = this.create(source, {
      channelId,
      channelName,
      modelScope: { channelId, channelName },
    })
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

  /**
   * Get all distinct channelIds for active sessions matching a given source and channelName.
   * Used for broadcasting notifications to all active conversations in a channel.
   */
  getActiveChannelIds(source: SessionSource, channelName?: string): string[] {
    const ids = new Set<string>()
    for (const session of this.sessions.values()) {
      const s = session.data
      if (
        s.channelId &&
        s.source === source &&
        (s.status === 'active' || s.status === 'idle') &&
        (!channelName || s.channelName === channelName)
      ) {
        ids.add(s.channelId)
      }
    }
    return Array.from(ids)
  }

  // --- Persistence methods ---

  /**
   * Restore active/idle sessions from the database on startup.
   * Returns the number of sessions restored.
   */
  restoreFromDB(): number {
    if (!this.sessionDb) return 0

    this.loadChannelModelPreferences()
    const rows = this.sessionDb.loadActiveSessions().map((row) => this.normalizeRow(row))
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
      const modelScope = this.getModelScope(row.source, row.channelId, row.channelName)
      const session = Session.restore(
        data,
        messages,
        this.modelRouter,
        this.toolRegistry,
        this.createSessionDeps(row.source, modelScope),
        row.systemPrompt
      )

      if (row.agentConfigJson) {
        try {
          const agentConfig = JSON.parse(row.agentConfigJson)
          session.initAgent(agentConfig)
        } catch {
          // If agent config is invalid, skip re-init — session still usable
        }
      }

      this.sessions.set(session.data.id, session)

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
    const row = this.sessionDb?.getSession(id)
    return row ? this.normalizeRow(row) : null
  }

  getMessagesFromDB(id: string): Message[] {
    return this.sessionDb?.loadSessionMessages(id) ?? []
  }

  listAllFromDB(filter?: { status?: SessionStatus; limit?: number; offset?: number }): SessionRow[] {
    return (this.sessionDb?.loadAllSessions(filter) ?? []).map((row) => this.normalizeRow(row))
  }
}
