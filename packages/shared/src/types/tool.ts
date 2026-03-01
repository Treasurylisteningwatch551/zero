import type { SecretFilter } from './config'

export interface ToolContext {
  sessionId: string
  workDir: string
  logger: ToolLogger
  secretFilter?: SecretFilter
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
