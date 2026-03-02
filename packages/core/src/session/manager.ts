import type { SessionSource } from '@zero-os/shared'
import type { ModelRouter } from '@zero-os/model'
import type { ToolRegistry } from '../tool/registry'
import { Session, type SessionDeps } from './session'

/**
 * Manages all active sessions.
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map()
  private modelRouter: ModelRouter
  private toolRegistry: ToolRegistry
  private deps: SessionDeps

  constructor(modelRouter: ModelRouter, toolRegistry: ToolRegistry, deps: SessionDeps = {}) {
    this.modelRouter = modelRouter
    this.toolRegistry = toolRegistry
    this.deps = deps
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

  /**
   * Remove a completed session from active tracking.
   */
  remove(id: string): void {
    this.sessions.delete(id)
  }
}
