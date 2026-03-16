import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChannelSessionSelector } from '../components/session/ChannelSessionSelector'
import { SessionDetailScreen } from '../components/session/SessionDetailScreen'
import { useWebSocket } from '../hooks/useWebSocket'
import { apiFetch } from '../lib/api'
import {
  type ChannelSessionCandidate,
  resolveChannelSessionCandidate,
} from './session-detail-helpers'

export function SessionChannelDetailPage() {
  const navigate = useNavigate()
  const { channel } = useParams({ from: '/sessions/channel/$channel/detail' })
  const search = useSearch({ from: '/sessions/channel/$channel/detail' }) as {
    source?: string
    channelName?: string
  }

  const [candidates, setCandidates] = useState<ChannelSessionCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [inferredSource, setInferredSource] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const activeSource = search.source ?? inferredSource

  const fetchCandidatesByChannel = useCallback(
    (showLoading = true) => {
      if (showLoading) setLoading(true)
      return apiFetch<{ sessions: ChannelSessionCandidate[] }>(
        `/api/sessions/channel/${encodeURIComponent(channel)}/active`,
      )
        .then((res) => {
          const sessions = res.sessions ?? []
          setCandidates(sessions)
          setInferredSource(sessions[0]?.source ?? null)
        })
        .catch(() => {
          setCandidates([])
          setInferredSource(null)
        })
        .finally(() => setLoading(false))
    },
    [channel],
  )

  const fetchCandidatesBySource = useCallback((source: string, showLoading = true) => {
    if (showLoading) setLoading(true)
    return apiFetch<{ sessions: ChannelSessionCandidate[] }>(
      `/api/sessions/source/${encodeURIComponent(source)}/active`,
    )
      .then((res) => setCandidates(res.sessions ?? []))
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (search.source) {
      void fetchCandidatesBySource(search.source)
      return
    }

    void fetchCandidatesByChannel()
  }, [fetchCandidatesByChannel, fetchCandidatesBySource, search.source])

  useEffect(() => {
    if (search.source) {
      setInferredSource(null)
    }
  }, [search.source])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const onSessionEvent = useCallback(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (activeSource) {
        void fetchCandidatesBySource(activeSource, false)
        return
      }

      void fetchCandidatesByChannel(false)
    }, 300)
  }, [activeSource, fetchCandidatesByChannel, fetchCandidatesBySource])

  useWebSocket({
    url: `ws://${window.location.host}/ws`,
    topics: ['session:create', 'session:update', 'session:end'],
    onEvent: onSessionEvent,
  })

  const selectedCandidate = useMemo(
    () => resolveChannelSessionCandidate(candidates, channel, search.channelName),
    [candidates, channel, search.channelName],
  )

  useEffect(() => {
    if (loading || !selectedCandidate) return

    if (
      search.source !== selectedCandidate.source ||
      search.channelName !== selectedCandidate.channelName ||
      channel !== selectedCandidate.channelId
    ) {
      navigate({
        to: '/sessions/channel/$channel/detail',
        params: { channel: selectedCandidate.channelId },
        search: {
          source: selectedCandidate.source,
          channelName: selectedCandidate.channelName,
        },
        replace: true,
      })
    }
  }, [channel, loading, navigate, search.channelName, search.source, selectedCandidate])

  const selector = (
    <ChannelSessionSelector
      candidates={candidates}
      selectedCandidate={selectedCandidate}
      activeSource={activeSource}
      loading={loading}
      onSelect={(next, rawValue) => {
        navigate({
          to: '/sessions/channel/$channel/detail',
          params: { channel: next?.channelId ?? rawValue },
          search: {
            source: next?.source ?? selectedCandidate?.source ?? activeSource ?? undefined,
            channelName: next?.channelName,
          },
        })
      }}
    />
  )

  return (
    <SessionDetailScreen
      sessionId={selectedCandidate?.id}
      topContent={selector}
      emptyState={
        <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">
          {loading
            ? 'Loading active channel sessions...'
            : `No active or idle sessions found${activeSource ? ` for source ${activeSource}` : ''}.`}
        </div>
      }
    />
  )
}
