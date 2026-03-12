import { appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { now } from '@zero-os/shared'
import type { StopReason } from '@zero-os/shared'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: string
  level: LogLevel
  sessionId?: string
  event: string
  [key: string]: unknown
}

export interface RequestLogEntry {
  id: string
  parentId?: string
  sessionId: string
  snapshotId?: string
  model: string
  provider: string
  userPrompt: string
  response: string
  stopReason: StopReason
  toolUseCount: number
  tokens: {
    input: number
    output: number
    cacheWrite?: number
    cacheRead?: number
  }
  cost: number
  durationMs?: number
  ts: string
}

export interface SnapshotEntry {
  id: string
  sessionId: string
  trigger: string
  model?: string
  parentSnapshot?: string
  systemPrompt?: string
  tools?: string[]
  identityMemory?: string
  compressedSummary?: string
  messagesBefore?: number
  messagesAfter?: number
  compressedRange?: string
  ts: string
}

export interface ClosureLogEntry {
  ts: string
  sessionId: string
  event: 'task_closure_decision' | 'task_closure_skipped' | 'task_closure_trim_failed'
  action?: string
  reason?: string
  skipReason?: string
  trimFromPreview?: string
  userMessagePreview?: string
  assistantTailPreview?: string
  rawClassifierResponse?: string
  assistantMessageId?: string
  assistantMessageCreatedAt?: string
  assistantMessagePreview?: string
  error?: string
}

export interface OperationLogEntry {
  ts: string
  level: LogLevel
  sessionId: string
  event: string
  tool: string
  input: string
  outputSummary: string
  durationMs: number
  model?: string
}

/**
 * JSONL Logger — append-writes structured log entries to files.
 */
export class JsonlLogger {
  private basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true })
    }
  }

  private appendLine(file: string, data: unknown): void {
    const filePath = `${this.basePath}/${file}`
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    appendFileSync(filePath, JSON.stringify(data) + '\n', 'utf-8')
  }

  /**
   * Log a general operation event.
   */
  logOperation(entry: Omit<OperationLogEntry, 'ts'>): void {
    this.appendLine('operations.jsonl', { ...entry, ts: now() })
  }

  /**
   * Log an LLM request.
   */
  logRequest(entry: Omit<RequestLogEntry, 'ts'>): void {
    this.appendLine('requests.jsonl', { ...entry, ts: now() })
  }

  /**
   * Log an LLM request to the session-scoped ledger.
   */
  logSessionRequest(entry: Omit<RequestLogEntry, 'ts'>): void {
    this.appendLine(`sessions/${entry.sessionId}/requests.jsonl`, { ...entry, ts: now() })
  }

  /**
   * Log a context snapshot.
   */
  logSnapshot(entry: Omit<SnapshotEntry, 'ts'>): void {
    this.appendLine(`sessions/${entry.sessionId}/snapshots.jsonl`, { ...entry, ts: now() })
  }

  /**
   * Log a session-scoped task closure event.
   */
  logSessionClosure(entry: Omit<ClosureLogEntry, 'ts'>): void {
    this.appendLine(`sessions/${entry.sessionId}/closure.jsonl`, { ...entry, ts: now() })
  }

  /**
   * General log entry.
   */
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    this.appendLine('operations.jsonl', { ts: now(), level, event, ...data })
  }

  /**
   * Read all entries from a JSONL file.
   */
  readEntries<T = unknown>(file: string): T[] {
    const filePath = `${this.basePath}/${file}`
    return this.readJsonlFile<T>(filePath)
  }

  /**
   * Read entries from a session-scoped JSONL file.
   */
  readSessionEntries<T = unknown>(sessionId: string, file: string): T[] {
    const filePath = `${this.basePath}/sessions/${sessionId}/${file}`
    return this.readJsonlFile<T>(filePath)
  }

  /**
   * Read requests for a session, falling back to legacy global requests.jsonl.
   */
  readSessionRequests(sessionId: string): RequestLogEntry[] {
    const sessionFile = `${this.basePath}/sessions/${sessionId}/requests.jsonl`
    if (existsSync(sessionFile)) {
      return this.readJsonlFile<RequestLogEntry>(sessionFile)
    }

    return this.readEntries<RequestLogEntry>('requests.jsonl')
      .filter((entry) => entry.sessionId === sessionId)
      .sort((left, right) => left.ts.localeCompare(right.ts))
  }

  /**
   * Read task closure events for a session, falling back to legacy operations.jsonl.
   */
  readSessionClosures(sessionId: string): ClosureLogEntry[] {
    const sessionFile = `${this.basePath}/sessions/${sessionId}/closure.jsonl`
    if (existsSync(sessionFile)) {
      return this.readJsonlFile<ClosureLogEntry>(sessionFile)
    }

    return this.readEntries<ClosureLogEntry>('operations.jsonl')
      .filter((entry) => {
        return entry.sessionId === sessionId && (
          entry.event === 'task_closure_decision' ||
          entry.event === 'task_closure_skipped' ||
          entry.event === 'task_closure_trim_failed'
        )
      })
      .sort((left, right) => left.ts.localeCompare(right.ts))
  }

  /**
   * Read snapshots for a session, falling back to legacy global snapshots.jsonl.
   */
  readSessionSnapshots(sessionId: string): SnapshotEntry[] {
    const sessionFile = `${this.basePath}/sessions/${sessionId}/snapshots.jsonl`
    if (existsSync(sessionFile)) {
      return this.readJsonlFile<SnapshotEntry>(sessionFile)
    }

    return this.readEntries<SnapshotEntry>('snapshots.jsonl')
      .filter((entry) => entry.sessionId === sessionId)
      .sort((left, right) => left.ts.localeCompare(right.ts))
  }

  /**
   * Read all request entries across legacy global and session-scoped ledgers.
   */
  readAllRequests(): RequestLogEntry[] {
    const deduped = new Map<string, RequestLogEntry>()

    for (const entry of this.readEntries<RequestLogEntry>('requests.jsonl')) {
      deduped.set(entry.id, entry)
    }

    const sessionsDir = `${this.basePath}/sessions`
    if (existsSync(sessionsDir)) {
      for (const dirent of readdirSync(sessionsDir, { withFileTypes: true })) {
        if (!dirent.isDirectory()) continue
        for (const entry of this.readSessionEntries<RequestLogEntry>(dirent.name, 'requests.jsonl')) {
          deduped.set(entry.id, entry)
        }
      }
    }

    return Array.from(deduped.values()).sort((left, right) => left.ts.localeCompare(right.ts))
  }

  /**
   * Read all snapshots across legacy global and session-scoped ledgers.
   */
  readAllSnapshots(): SnapshotEntry[] {
    const deduped = new Map<string, SnapshotEntry>()

    for (const entry of this.readEntries<SnapshotEntry>('snapshots.jsonl')) {
      deduped.set(entry.id, entry)
    }

    const sessionsDir = `${this.basePath}/sessions`
    if (existsSync(sessionsDir)) {
      for (const dirent of readdirSync(sessionsDir, { withFileTypes: true })) {
        if (!dirent.isDirectory()) continue
        for (const entry of this.readSessionEntries<SnapshotEntry>(dirent.name, 'snapshots.jsonl')) {
          deduped.set(entry.id, entry)
        }
      }
    }

    return Array.from(deduped.values()).sort((left, right) => left.ts.localeCompare(right.ts))
  }

  private readJsonlFile<T>(filePath: string): T[] {
    if (!existsSync(filePath)) return []
    const content = readFileSync(filePath, 'utf-8')
    if (content.trim().length === 0) return []
    return content
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T)
  }
}
