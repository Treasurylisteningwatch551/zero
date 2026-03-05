import type { ToolDefinition } from './message'
import type { Memory } from './memory'

export interface SkillDefinition {
  name: string
  description: string
  allowedTools: string[]
  content: string
  sourcePath: string
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
}

/**
 * Dynamic context injected into user message as <system-reminder> each turn.
 */
export interface DynamicContext {
  currentTime: string
  memo: string
  retrievedMemories: Memory[]
  newSkills?: SkillDefinition[]
}

export interface ContextBudget {
  role: number
  toolRules: number
  constraints: number
  identity: number
  skillCatalog: number
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
  }
}
