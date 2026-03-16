export type SessionJudgeDimensionKey =
  | 'task_completion'
  | 'context_management'
  | 'memory_usage'
  | 'evidence_grounding'
  | 'tool_efficiency'
  | 'cost_efficiency'
  | 'recovery_honesty'

export interface SessionJudgeDimension {
  key: SessionJudgeDimensionKey
  label: string
  score: number
  maxScore: number
  rationale: string
}

export interface SessionJudgeFinding {
  severity: 'info' | 'warn' | 'bad'
  title: string
  evidence: string
}

export interface SessionJudgeSignals {
  totalCost: number
  requestCount: number
  toolCallCount: number
  duplicateToolCallCount: number
  memorySearchCount: number
  memoryGetCount: number
  memoryWriteCount: number
  closureCount: number
}

export interface SessionJudgeResult {
  overallScore: number
  verdict: 'strong' | 'mixed' | 'weak'
  confidence: 'high' | 'medium' | 'low'
  summary: string
  dimensions: SessionJudgeDimension[]
  findings: SessionJudgeFinding[]
  signals: SessionJudgeSignals
}

export interface SessionJudgeResponse {
  sessionId: string
  model: string
  generatedAt: string
  result: SessionJudgeResult
}
