import { MagnifyingGlass } from '@phosphor-icons/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { PulseDot } from '../components/shared/PulseDot'
import { Skeleton } from '../components/shared/Skeleton'
import { useNavigate } from '@tanstack/react-router'
import { apiFetch } from '../lib/api'
import { useWebSocket } from '../hooks/useWebSocket'
import { formatTimeAgo, formatModelHistory, formatNumber, formatCost } from '../lib/format'
import { statusColors } from '../lib/colors'
import { useUIStore } from '../stores/ui'

interface ModelHistoryEntry {
  model: string
  from: string
  to: string | null
}

interface SessionInfo {
  id: string
  source: string
  status: string
  currentModel: string
  createdAt: string
  updatedAt: string
  messageCount: number
  tags: string[]
  summary?: string
  modelHistory: ModelHistoryEntry[]
  toolCallCount: number
  totalTokens: number
  totalCost: number
}

function mapStatusToDot(status: string): 'active' | 'idle' | 'error' | 'warning' {
  if (status === 'active') return 'active'
  if (status === 'idle' || status === 'completed' || status === 'archived') return 'idle'
  if (status === 'failed') return 'error'
  return 'idle'
}

const SOURCE_FILTERS = ['all', 'web', 'feishu', 'telegram', 'scheduler'] as const

export function SessionsPage() {
  const [filter, setFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [focusIndex, setFocusIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wsDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastKeyRef = useRef<string>('')
  const filterRef = useRef(filter)
  const searchRef = useRef(search)
  filterRef.current = filter
  searchRef.current = search
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { setSelectedSessionId } = useUIStore()

  function fetchSessions(f: string, q: string, showLoading = true) {
    if (showLoading) setLoading(true)
    const params = new URLSearchParams()
    if (f !== 'all') params.set('filter', f)
    if (q) params.set('q', q)
    const qs = params.toString()
    apiFetch<{ sessions: SessionInfo[] }>(`/api/sessions${qs ? `?${qs}` : ''}`)
      .then((res) => setSessions(res.sessions))
      .catch(() => {})
      .finally(() => { if (showLoading) setLoading(false) })
  }

  useEffect(() => {
    fetchSessions(filter, search)
  }, [filter])

  function handleSearch(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSessions(filter, value), 300)
  }

  function openSession(id: string) {
    setSelectedSessionId(id)
    navigate({ to: '/sessions/$id', params: { id } })
  }

  // Apply source filter client-side
  const filteredSessions = sourceFilter === 'all'
    ? sessions
    : sessions.filter((s) => s.source === sourceFilter)

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    if (e.key === 'j') {
      setFocusIndex((prev) => Math.min(prev + 1, filteredSessions.length - 1))
    } else if (e.key === 'k') {
      setFocusIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && focusIndex >= 0 && focusIndex < filteredSessions.length) {
      openSession(filteredSessions[focusIndex].id)
    } else if (e.key === 'Escape') {
      setFocusIndex(-1)
    } else if (e.key === 'g' && lastKeyRef.current === 'g') {
      setFocusIndex(0)
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (e.key === 'G') {
      setFocusIndex(filteredSessions.length - 1)
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    }

    lastKeyRef.current = e.key
  }, [filteredSessions, focusIndex])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // WebSocket: auto-refresh session list on session events
  const onSessionEvent = useCallback(() => {
    clearTimeout(wsDebounceRef.current)
    wsDebounceRef.current = setTimeout(() => {
      fetchSessions(filterRef.current, searchRef.current, false)
    }, 500)
  }, [])

  useWebSocket({
    url: `ws://${window.location.host}/ws`,
    topics: ['session:create', 'session:update', 'session:end'],
    onEvent: onSessionEvent,
  })

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-[20px] font-bold tracking-tight mb-4">Sessions</h1>

      {/* Filters */}
      <div className="card p-4 mb-4 animate-fade-up">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2">
            {['all', 'active', 'completed', 'archived'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-[12px] transition-colors ${
                  filter === f
                    ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="relative">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-disabled)]" />
            <input
              type="text"
              placeholder="Search sessions..."
              className="input-field pl-9 w-[200px]"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Source filters */}
        <div className="flex gap-1.5 mt-3 pt-3 border-t border-[var(--color-border)]">
          <span className="text-[11px] text-[var(--color-text-disabled)] mr-1 self-center">Source:</span>
          {SOURCE_FILTERS.map((sf) => (
            <button
              key={sf}
              onClick={() => setSourceFilter(sf)}
              className={`px-2.5 py-0.5 rounded text-[11px] transition-colors ${
                sourceFilter === sf
                  ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {sf}
            </button>
          ))}
        </div>
      </div>

      {/* Session list */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-center gap-3">
                <Skeleton className="w-2 h-2 rounded-full" />
                <Skeleton className="h-3.5 w-48" />
                <span className="flex-1" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="ml-7 mt-2 flex gap-2">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-2.5 w-32" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="card p-12 text-center animate-fade-up" style={{ animationDelay: '60ms' }}>
          <p className="text-[14px] text-[var(--color-text-muted)] mb-2">No sessions yet</p>
          <p className="text-[12px] text-[var(--color-text-disabled)]">
            Sessions will appear here when you start interacting with ZeRo OS
          </p>
        </div>
      ) : (
        <div ref={listRef} className="space-y-2 animate-fade-up" style={{ animationDelay: '60ms' }}>
          {filteredSessions.map((s, idx) => (
            <div
              key={s.id}
              onClick={() => openSession(s.id)}
              className={`card p-4 cursor-pointer hover:bg-white/[0.02] transition-colors ${
                idx === focusIndex ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30' : ''
              }`}
            >
              {/* Line 1: Status + ID + Summary */}
              <div className="flex items-center gap-3">
                <PulseDot status={mapStatusToDot(s.status)} />
                <span className="text-[13px] font-mono text-[var(--color-text-primary)]">{s.id}</span>
                {s.summary && (
                  <span className="text-[13px] text-[var(--color-text-secondary)] truncate">{s.summary}</span>
                )}
                <span className="flex-1" />
                <span className={`text-[11px] ${statusColors[s.status] ?? 'text-slate-400'}`}>
                  {s.status}
                </span>
              </div>

              {/* Line 2: Source · Model history · Time */}
              <div className="ml-7 mt-1 text-[11px] text-[var(--color-text-muted)]">
                <span className="capitalize">{s.source}</span>
                {' · '}
                <span className="font-mono">
                  {s.modelHistory && s.modelHistory.length > 0
                    ? formatModelHistory(s.modelHistory)
                    : s.currentModel}
                </span>
                {' · '}
                <span>{formatTimeAgo(s.createdAt)}</span>
                {s.status === 'active' && ' - ongoing'}
              </div>

              {/* Line 3: Tool calls · Tokens · Cost */}
              <div className="ml-7 mt-0.5 text-[11px] text-[var(--color-text-disabled)]">
                {s.toolCallCount} tool calls
                {' · '}
                {formatNumber(s.totalTokens)} tokens
                {' · '}
                {formatCost(s.totalCost)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
