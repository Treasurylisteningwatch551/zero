export type SessionSource = 'feishu' | 'telegram' | 'scheduler' | 'web'

export type SessionStatus = 'active' | 'idle' | 'completed' | 'failed' | 'archived'

export interface ModelHistoryEntry {
  model: string
  from: string
  to: string | null
}

export interface Session {
  id: string
  createdAt: string
  updatedAt: string
  source: SessionSource
  status: SessionStatus
  currentModel: string
  modelHistory: ModelHistoryEntry[]
  summary?: string
  tags: string[]
  channelId?: string
}
