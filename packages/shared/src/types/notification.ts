export interface Notification {
  id: string
  type:
    | 'authorization'
    | 'verification'
    | 'config_missing'
    | 'model_degradation'
    | 'repair_failure'
    | 'system'
  severity: 'info' | 'warn' | 'error'
  title: string
  description: string
  source: string
  sessionId?: string
  actionable: boolean
  actionUrl?: string
  createdAt: string
  dismissedAt?: string
}
