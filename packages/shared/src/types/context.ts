import type { ToolDefinition } from './message'
import type { Memory } from './memory'

export interface SkillDefinition {
  name: string
  description: string
  allowedTools: string[]
  content: string
}

export interface PromptComponents {
  agentName: string
  agentDescription: string
  tools: ToolDefinition[]
  skills?: SkillDefinition[]
  globalIdentity: string
  agentIdentity: string
  memo: string
  retrievedMemories: Memory[]
  currentTime: string
  workspacePath?: string
  projectRoot?: string
}

export interface ContextBudget {
  role: number
  toolRules: number
  constraints: number
  identity: number
  memo: number
  retrievedMemory: number
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
