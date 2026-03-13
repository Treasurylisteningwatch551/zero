import type { ScheduleConfig, SecretFilter } from './config'
import type { Memory, MemorySearchOptions, MemoryType, ScoredMemoryMatch } from './memory'

/**
 * Minimal interface for structured logging from tools.
 */
export interface ObservabilityHandle {
  logOperation(entry: {
    level: string
    sessionId: string
    event: string
    tool: string
    input: string
    outputSummary: string
    durationMs: number
  }): void
  recordOperation(entry: {
    sessionId: string
    tool: string
    event: string
    success: boolean
    durationMs: number
    createdAt: string
  }): void
}

export interface ToolContext {
  sessionId: string
  currentModel?: string
  workDir: string
  projectRoot?: string
  logger: ToolLogger
  secretFilter?: SecretFilter
  observability?: ObservabilityHandle
  secretResolver?: (ref: string) => string | undefined
  memoryRetriever?: {
    retrieve(query: string, options?: MemorySearchOptions): Promise<Memory[]>
    retrieveScored?(query: string, options?: MemorySearchOptions): Promise<ScoredMemoryMatch[]>
  }
  memoryStore?: {
    create(
      type: MemoryType,
      title: string,
      content: string,
      options?: Record<string, unknown>,
    ): Promise<Memory>
    update(
      type: MemoryType,
      id: string,
      updates: Record<string, unknown>,
    ): Promise<Memory | undefined>
    delete(type: MemoryType, id: string): Promise<boolean>
    list(type: MemoryType): Memory[]
    get(type: MemoryType, id: string): Memory | undefined
    getRelativePath?(type: MemoryType, id: string): string | undefined
    readByPath?(
      path: string,
      options?: { from?: number; lines?: number },
    ): { path: string; text: string } | undefined
  }
  channelBinding?: {
    source: string
    channelName: string
    channelId: string
  }
  schedulerHandle?: {
    addAndStart(config: ScheduleConfig): void
    remove(name: string): boolean
    getStatus(): Array<{ name: string; nextRun: Date; running: boolean; lastRun?: Date }>
  }
  scheduleStore?: {
    save(config: ScheduleConfig): void
    delete(name: string): boolean
  }
}

export interface ToolLogger {
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, data?: Record<string, unknown>): void
}

export interface ToolResult {
  success: boolean
  output: string
  outputSummary: string
  artifacts?: string[]
}

export interface ToolRegistryEntry {
  name: string
  description: string
  parameters: Record<string, unknown>
  trusted: boolean
}
