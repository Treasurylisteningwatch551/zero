import { Archive, Clock, CurrencyDollar } from '@phosphor-icons/react'
import { formatModelHistory, formatTimeRange, formatNumber, formatCost } from '../../lib/format'
import { apiPost } from '../../lib/api'

interface ModelHistoryEntry {
  model: string
  from: string
  to: string | null
}

interface Props {
  sessionId: string
  summary?: string
  source: string
  createdAt: string
  updatedAt: string
  modelHistory: ModelHistoryEntry[]
  requestCount: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCost: number
  onArchived?: () => void
}

export function MetadataBar({
  sessionId,
  summary,
  source,
  createdAt,
  updatedAt,
  modelHistory,
  requestCount,
  totalTokens,
  inputTokens,
  outputTokens,
  totalCost,
  onArchived,
}: Props) {
  async function handleArchive() {
    if (!confirm('Archive this session?')) return
    await apiPost(`/api/sessions/${sessionId}/archive`, {})
    onArchived?.()
  }

  return (
    <div className="card p-4 animate-fade-up">
      {/* Title row */}
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
            {summary || sessionId}
          </h2>
          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
            <span className="capitalize">{source}</span>
            {' · '}
            <Clock size={12} className="inline -mt-0.5" />
            {' '}
            {formatTimeRange(createdAt, updatedAt)}
          </p>
        </div>
        <button
          onClick={handleArchive}
          className="px-3 py-1.5 rounded-md text-[11px] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-red-400 hover:border-red-400/30 transition-colors flex items-center gap-1.5"
        >
          <Archive size={14} />
          Archive
        </button>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-[11px] text-[var(--color-text-muted)] flex-wrap">
        <span className="font-mono">
          {formatModelHistory(modelHistory)}
        </span>
        <span className="text-[var(--color-text-disabled)]">·</span>
        <span>{requestCount} calls</span>
        <span className="text-[var(--color-text-disabled)]">·</span>
        <span>
          {formatNumber(totalTokens)} tokens
          <span className="text-[var(--color-text-disabled)]"> ({formatNumber(inputTokens)} in / {formatNumber(outputTokens)} out)</span>
        </span>
        <span className="text-[var(--color-text-disabled)]">·</span>
        <span className="flex items-center gap-0.5">
          <CurrencyDollar size={12} />
          {formatCost(totalCost)}
        </span>
      </div>
    </div>
  )
}
