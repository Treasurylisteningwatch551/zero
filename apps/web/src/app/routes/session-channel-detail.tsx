import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { apiFetch } from '../lib/api'
import { formatTimeAgo } from '../lib/format'
import { useWebSocket } from '../hooks/useWebSocket'
import { SessionDetailScreen } from '../components/session/SessionDetailScreen'
import {
  resolveChannelSessionCandidate,
  type ChannelSessionCandidate,
} from './session-detail-helpers'

export function SessionChannelDetailPage() {
  const navigate = useNavigate()
  const { channel } = useParams({ from: '/sessions/channel/$channel/detail' })
  const search = useSearch({ from: '/sessions/channel/$channel/detail' }) as { source?: string }

  const [candidates, setCandidates] = useState<ChannelSessionCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const fetchCandidates = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true)
    return apiFetch<{ sessions: ChannelSessionCandidate[] }>(
      `/api/sessions/channel/${encodeURIComponent(channel)}/active`,
    )
      .then((res) => setCandidates(res.sessions ?? []))
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false))
  }, [channel])

  useEffect(() => {
    void fetchCandidates()
  }, [fetchCandidates])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const onSessionEvent = useCallback(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void fetchCandidates(false)
    }, 300)
  }, [fetchCandidates])

  useWebSocket({
    url: `ws://${window.location.host}/ws`,
    topics: ['session:create', 'session:update', 'session:end'],
    onEvent: onSessionEvent,
  })

  const selectedCandidate = useMemo(
    () => resolveChannelSessionCandidate(candidates, search.source),
    [candidates, search.source],
  )

  useEffect(() => {
    if (loading || !selectedCandidate || search.source === selectedCandidate.source) return
    navigate({
      to: '/sessions/channel/$channel/detail',
      params: { channel },
      search: { source: selectedCandidate.source },
      replace: true,
    })
  }, [channel, loading, navigate, search.source, selectedCandidate])

  const selector = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-wide">Channel</span>
      <span className="text-[11px] font-mono text-[var(--color-text-secondary)]">{channel}</span>
      <span className="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-wide ml-2">Source</span>
      <select
        className="input-field py-1.5 px-2.5 min-w-[180px]"
        value={selectedCandidate?.source ?? ''}
        disabled={loading || candidates.length === 0}
        onChange={(e) => {
          navigate({
            to: '/sessions/channel/$channel/detail',
            params: { channel },
            search: { source: e.target.value },
          })
        }}
      >
        {candidates.map((candidate) => (
          <option key={`${candidate.source}-${candidate.id}`} value={candidate.source}>
            {candidate.source} · {candidate.status} · {formatTimeAgo(candidate.updatedAt)}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <SessionDetailScreen
      sessionId={selectedCandidate?.id}
      headerContent={selector}
      emptyState={
        <div className="p-6 max-w-[1400px] mx-auto">
          <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">
            {loading
              ? 'Loading active channel sessions...'
              : `No active or idle sessions found for channel ${channel}.`}
          </div>
        </div>
      }
    />
  )
}
