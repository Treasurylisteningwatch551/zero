import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
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
  ts: string
}

export interface SnapshotEntry {
  id: string
  sessionId: string
  trigger: string
  parentSnapshot?: string
  systemPrompt?: string
  tools?: string[]
  identityMemory?: string
  compressedSummary?: string
  messagesBefore?: number
  messagesAfter?: number
  ts: string
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
   * Log a context snapshot.
   */
  logSnapshot(entry: Omit<SnapshotEntry, 'ts'>): void {
    this.appendLine('snapshots.jsonl', { ...entry, ts: now() })
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
    if (!existsSync(filePath)) return []
    const content = readFileSync(filePath, 'utf-8')
    return content
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T)
  }
}
