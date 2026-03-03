import type { SecretFilter } from './config'

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
  workDir: string
  logger: ToolLogger
  secretFilter?: SecretFilter
  observability?: ObservabilityHandle
  secretResolver?: (ref: string) => string | undefined
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
