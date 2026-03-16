import type { ToolDefinition } from './message'

export interface SkillDefinition {
  name: string
  description: string
  allowedTools: string[]
  content: string
  sourcePath: string
}

/**
 * Controls which hardcoded sections are included in the system prompt.
 * - "full": All sections (default, for main agent)
 * - "minimal": Reduced sections (role + toolRules + constraints) — used for subagents
 * - "none": Just basic identity line, no sections
 */
export type PromptMode = 'full' | 'minimal' | 'none'

/**
 * A workspace bootstrap file loaded from .zero/ directory.
 * Injected into system prompt tail as Project Context.
 */
export interface BootstrapFile {
  /** File name, e.g. "SOUL.md" */
  name: string
  /** Absolute file path */
  path: string
  /** File content (may be truncated by size limits) */
  content: string
}

/**
 * Compact runtime information injected as a single key=value line.
 */
export interface RuntimeInfo {
  agentId?: string
  host?: string
  os?: string
  arch?: string
  model?: string
  shell?: string
  channel?: string
  projectRoot?: string
  /** Channel capability hints — auto-injected into system prompt */
  channelCapabilities?: Record<string, unknown>
}

/**
 * Static components for System Prompt — built once per session for prompt cache stability.
 */
export interface PromptComponents {
  agentName: string
  agentDescription: string
  tools: ToolDefinition[]
  skills?: SkillDefinition[]
  globalIdentity: string
  agentIdentity: string
  workspacePath?: string
  projectRoot?: string
  /** Controls which sections are included. Defaults to "full". */
  promptMode?: PromptMode
  /** Workspace bootstrap files (SOUL.md, USER.md, TOOLS.md) */
  bootstrapFiles?: BootstrapFile[]
  /** Compact runtime info for the Runtime line */
  runtimeInfo?: RuntimeInfo
}

/**
 * Dynamic context injected into user message as <system-reminder>.
 * Currently reserved for runtime-discovered skill notifications only.
 */
export interface DynamicContext {
  newSkills?: SkillDefinition[]
}

export interface ContextBudget {
  role: number
  toolRules: number
  constraints: number
  executionMode: number
  safety: number
  toolCallStyle: number
  identity: number
  skillCatalog: number
  runtime: number
  bootstrapContext: number
  conversation: number
  reserved: number
}

export interface CompressionResult {
  summary: string
  retainedMessages: import('./message').Message[]
  stats: {
    messagesBefore: number
    messagesAfter: number
    tokensBefore: number
    tokensAfter: number
    compressedRange?: string
  }
}
