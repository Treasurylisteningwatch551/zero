import type { ToolDefinition } from './message'
import type { Memory } from './memory'

export interface PromptComponents {
  agentName: string
  agentDescription: string
  tools: ToolDefinition[]
  globalIdentity: string
  agentIdentity: string
  memo: string
  retrievedMemories: Memory[]
  currentTime: string
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
