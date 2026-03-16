import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { type SessionStatus, getSessionLogRelativeDir, now } from '@zero-os/shared'
import type { CompletionResponse, StopReason, ToolResultBlock } from '@zero-os/shared'
import { collapseTraceEntries, type TraceEntry } from './trace'
import {
  projectSessionClosuresFromTraceEntries,
  projectSessionRequestsFromTraceEntries,
  projectSessionSnapshotsFromTraceEntries,
} from './trace-projections'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: string
  level: LogLevel
  sessionId?: string
  event: string
  [key: string]: unknown
}

export interface RequestToolCallEntry {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface RequestToolResultEntry extends ToolResultBlock {}

export interface RequestLogEntry {
  id: string
  turnIndex: number
  parentId?: string
  sessionId: string
  agentName?: string
  spawnedByRequestId?: string
  snapshotId?: string
  model: string
  provider: string
  userPrompt: string
  response: string
  reasoningContent?: string
  stopReason: StopReason
  toolUseCount: number
  toolCalls: RequestToolCallEntry[]
  toolResults: RequestToolResultEntry[]
  toolNames?: string[]
  toolDefinitionsHash?: string
  systemHash?: string
  staticPrefixHash?: string
  messageCount?: number
  tokens: {
    input: number
    output: number
    cacheWrite?: number
    cacheRead?: number
    reasoning?: number
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

export interface TaskClosureClassifierRequest {
  system: string
  prompt: string
  maxTokens: number
}

export type TaskClosureClassifierResponse = CompletionResponse

export interface EventLogEntry {
  ts: string
  level: LogLevel
  sessionId?: string
  event: string
  [key: string]: unknown
}

export interface TaskClosureDecisionLogEntry {
  ts: string
  sessionId: string
  event: 'task_closure_decision'
  action: 'finish' | 'continue' | 'block'
  reason: string
  assistantMessageId?: string
  assistantMessageCreatedAt?: string
  classifierRequest: TaskClosureClassifierRequest
  classifierResponse?: TaskClosureClassifierResponse
  trimFrom?: string
}

export interface TaskClosureFailedLogEntry {
  ts: string
  sessionId: string
  event: 'task_closure_failed'
  reason: 'invalid_classifier_output' | 'classifier_failed'
  failureStage: 'parse_classifier_response' | 'request_classifier'
  assistantMessageId?: string
  assistantMessageCreatedAt?: string
  classifierRequest: TaskClosureClassifierRequest
  classifierResponse?: TaskClosureClassifierResponse
  classifierResponseRaw?: string
  error?: string
}

export type ClosureLogEntry = TaskClosureDecisionLogEntry | TaskClosureFailedLogEntry

export type ClosureLogEntryInput =
  | Omit<TaskClosureDecisionLogEntry, 'ts'>
  | Omit<TaskClosureFailedLogEntry, 'ts'>

/**
 * JSONL Logger — append-writes structured log entries to files.
 */
export class JsonlLogger {
  private basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
    this.ensureDir(basePath)
    this.ensureDir(this.getSessionsRoot())
    this.ensureDir(this.getActiveSessionsRoot())
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private getSessionsRoot(): string {
    return join(this.basePath, 'sessions')
  }

  private getActiveSessionsRoot(): string {
    return join(this.getSessionsRoot(), '_active')
  }

  private appendLine(file: string, data: unknown): void {
    const filePath = join(this.basePath, file)
    const dir = dirname(filePath)
    this.ensureDir(dir)
    appendFileSync(filePath, `${JSON.stringify(data)}\n`, 'utf-8')
  }

  private listSessionDirectories(): string[] {
    const sessionsDir = this.getSessionsRoot()
    if (!existsSync(sessionsDir)) return []

    const sessionDirs: string[] = []
    for (const dirent of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (dirent.name === '_active' || !dirent.isDirectory()) continue

      const entryPath = join(sessionsDir, dirent.name)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dirent.name)) {
        for (const sessionDirent of readdirSync(entryPath, { withFileTypes: true })) {
          if (!sessionDirent.isDirectory()) continue
          sessionDirs.push(join(entryPath, sessionDirent.name))
        }
        continue
      }

      sessionDirs.push(entryPath)
    }

    return sessionDirs
  }

  private removePathIfExists(path: string): void {
    try {
      const stat = lstatSync(path)
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        rmSync(path, { recursive: true, force: true })
        return
      }
      unlinkSync(path)
    } catch {}
  }

  syncSessionActiveState(sessionId: string, status: SessionStatus): void {
    const linkPath = join(this.getActiveSessionsRoot(), sessionId)
    if (status !== 'active') {
      this.removePathIfExists(linkPath)
      return
    }

    const sessionDir = join(this.basePath, getSessionLogRelativeDir(sessionId))
    this.ensureDir(sessionDir)
    this.ensureDir(this.getActiveSessionsRoot())

    const target = relative(this.getActiveSessionsRoot(), sessionDir)
    try {
      const currentTarget = readlinkSync(linkPath)
      if (currentTarget === target) return
      this.removePathIfExists(linkPath)
    } catch {}

    symlinkSync(target, linkPath, 'dir')
  }

  /**
   * Log a general event entry.
   */
  logEvent(entry: Omit<EventLogEntry, 'ts'>): void {
    this.appendLine('events.jsonl', { ...entry, ts: now() })
  }

  /**
   * General log entry.
   */
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    this.appendLine('events.jsonl', { ts: now(), level, event, ...data })
  }

  /**
   * Read all entries from a JSONL file.
   */
  readEntries<T = unknown>(file: string): T[] {
    return this.readJsonlFile<T>(join(this.basePath, file))
  }

  /**
   * Read entries from a session-scoped JSONL file.
   */
  readSessionEntries<T = unknown>(sessionId: string, file: string): T[] {
    const filePath = join(this.basePath, getSessionLogRelativeDir(sessionId), file)
    if (existsSync(filePath)) {
      return this.readJsonlFile<T>(filePath)
    }
    return []
  }

  /**
   * Read requests for a session from trace.jsonl.
   */
  readSessionRequests(sessionId: string): RequestLogEntry[] {
    return projectSessionRequestsFromTraceEntries(this.readSessionTraceEntries(sessionId)).map(
      (entry) => this.normalizeStoredRequestEntry(entry),
    )
  }

  /**
   * Read task closure events for a session from trace.jsonl.
   */
  readSessionClosures(sessionId: string): ClosureLogEntry[] {
    return projectSessionClosuresFromTraceEntries(this.readSessionTraceEntries(sessionId))
  }

  /**
   * Read snapshots for a session from trace.jsonl.
   */
  readSessionSnapshots(sessionId: string): SnapshotEntry[] {
    return projectSessionSnapshotsFromTraceEntries(this.readSessionTraceEntries(sessionId))
  }

  /**
   * Read the latest persisted trace snapshot for each span in a session.
   */
  readSessionTraceEntries(sessionId: string): TraceEntry[] {
    return collapseTraceEntries(this.readSessionEntries<TraceEntry>(sessionId, 'trace.jsonl'))
  }

  /**
   * Read all request entries across trace spans.
   */
  readAllRequests(): RequestLogEntry[] {
    const deduped = new Map<string, RequestLogEntry>()

    for (const entry of this.readAllTraceEntries()) {
      for (const projected of projectSessionRequestsFromTraceEntries([entry])) {
        deduped.set(projected.id, this.normalizeStoredRequestEntry(projected))
      }
    }

    return Array.from(deduped.values()).sort((left, right) => left.ts.localeCompare(right.ts))
  }

  /**
   * Read all persisted trace entries across sessions.
   */
  readAllTraceEntries(): TraceEntry[] {
    const entries: TraceEntry[] = []

    for (const sessionDir of this.listSessionDirectories()) {
      entries.push(
        ...collapseTraceEntries(this.readJsonlFile<TraceEntry>(join(sessionDir, 'trace.jsonl'))),
      )
    }

    return entries.sort((left, right) => left.startTime.localeCompare(right.startTime))
  }

  /**
   * Read all snapshots across trace spans.
   */
  readAllSnapshots(): SnapshotEntry[] {
    const deduped = new Map<string, SnapshotEntry>()

    for (const entry of this.readAllTraceEntries()) {
      for (const projected of projectSessionSnapshotsFromTraceEntries([entry])) {
        deduped.set(projected.id, projected)
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

  private normalizeStoredRequestEntry(entry: RequestLogEntry): RequestLogEntry {
    return {
      ...entry,
      toolCalls: this.normalizeToolCalls(entry.toolCalls),
      toolResults: this.normalizeToolResults(entry.toolResults),
    }
  }

  private normalizeToolCalls(toolCalls: unknown): RequestToolCallEntry[] {
    if (!Array.isArray(toolCalls)) return []

    return toolCalls.filter((toolCall): toolCall is RequestToolCallEntry =>
      Boolean(
        toolCall &&
          typeof toolCall === 'object' &&
          typeof (toolCall as RequestToolCallEntry).id === 'string' &&
          typeof (toolCall as RequestToolCallEntry).name === 'string' &&
          (toolCall as RequestToolCallEntry).input &&
          typeof (toolCall as RequestToolCallEntry).input === 'object' &&
          !Array.isArray((toolCall as RequestToolCallEntry).input),
      ),
    )
  }

  private normalizeToolResults(toolResults: unknown): RequestToolResultEntry[] {
    if (!Array.isArray(toolResults)) return []

    return toolResults.filter((toolResult): toolResult is RequestToolResultEntry =>
      Boolean(
        toolResult &&
          typeof toolResult === 'object' &&
          (toolResult as RequestToolResultEntry).type === 'tool_result' &&
          typeof (toolResult as RequestToolResultEntry).toolUseId === 'string' &&
          typeof (toolResult as RequestToolResultEntry).content === 'string' &&
          ((toolResult as RequestToolResultEntry).isError === undefined ||
            typeof (toolResult as RequestToolResultEntry).isError === 'boolean') &&
          ((toolResult as RequestToolResultEntry).outputSummary === undefined ||
            typeof (toolResult as RequestToolResultEntry).outputSummary === 'string'),
      ),
    )
  }
}
