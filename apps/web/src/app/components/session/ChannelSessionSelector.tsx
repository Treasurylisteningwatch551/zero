import type { ChannelSessionCandidate } from '../../routes/session-detail-helpers'
import { formatTimeAgo } from '../../lib/format'

interface ChannelSessionSelectorProps {
  candidates: ChannelSessionCandidate[]
  selectedCandidate: ChannelSessionCandidate | null
  activeSource?: string | null
  loading: boolean
  onSelect: (candidate: ChannelSessionCandidate | null, rawValue: string) => void
}

export function ChannelSessionSelector({
  candidates,
  selectedCandidate,
  activeSource,
  loading,
  onSelect,
}: ChannelSessionSelectorProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-wide">
        Source
      </span>
      <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">
        {selectedCandidate?.source ?? activeSource ?? '—'}
      </span>
      <span className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-wide ml-2">
        Channel
      </span>
      <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">
        {selectedCandidate?.channelName ?? '—'}
      </span>
      <span className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-wide ml-2">
        Channel ID
      </span>
      <select
        className="input-field py-1.5 px-2.5 min-w-[220px]"
        value={
          selectedCandidate
            ? `${selectedCandidate.channelName ?? selectedCandidate.source}::${selectedCandidate.channelId}`
            : ''
        }
        disabled={loading || candidates.length === 0}
        onChange={(e) => {
          const next = candidates.find(
            (candidate) =>
              `${candidate.channelName ?? candidate.source}::${candidate.channelId}` ===
              e.target.value,
          )
          onSelect(next ?? null, e.target.value)
        }}
      >
        {candidates.map((candidate) => (
          <option
            key={`${candidate.channelName ?? candidate.source}-${candidate.channelId}-${candidate.id}`}
            value={`${candidate.channelName ?? candidate.source}::${candidate.channelId}`}
          >
            {candidate.channelName ?? candidate.source} · {candidate.channelId} · {candidate.status} ·{' '}
            {formatTimeAgo(candidate.updatedAt)}
          </option>
        ))}
      </select>
    </div>
  )
}
