export type MemoryType =
  | 'session'
  | 'incident'
  | 'runbook'
  | 'decision'
  | 'note'
  | 'preference'
  | 'inbox'

export type MemoryStatus = 'draft' | 'verified' | 'archived' | 'conflict'

export interface Memory {
  id: string
  type: MemoryType
  title: string
  createdAt: string
  updatedAt: string
  status: MemoryStatus
  sessionId?: string
  confidence: number
  tags: string[]
  related: string[]
  content: string
}

export interface MemorySearchOptions {
  topN?: number
  confidenceThreshold?: number
  types?: MemoryType[]
  tags?: string[]
  status?: MemoryStatus[]
}
