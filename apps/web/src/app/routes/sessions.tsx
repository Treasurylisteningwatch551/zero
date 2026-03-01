import { MagnifyingGlass } from '@phosphor-icons/react'
import { useState, useEffect, useRef } from 'react'
import { PulseDot } from '../components/shared/PulseDot'
import { apiFetch } from '../lib/api'
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

export function SessionsPage() {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const { setCurrentPage, setSelectedSessionId } = useUIStore()

  function fetchSessions(f: string, q: string) {
    setLoading(true)
    const params = new URLSearchParams()
    if (f !== 'all') params.set('filter', f)
    if (q) params.set('q', q)
    const qs = params.toString()
    apiFetch<{ sessions: SessionInfo[] }>(`/api/sessions${qs ? `?${qs}` : ''}`)
      .then((res) => setSessions(res.sessions))
      .catch(() => {})
      .finally(() => setLoading(false))
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
    setCurrentPage('session-detail')
  }

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
      </div>

      {/* Session list */}
      {loading ? (
        <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">
          Loading sessions...
        </div>
      ) : sessions.length === 0 ? (
        <div className="card p-12 text-center animate-fade-up" style={{ animationDelay: '60ms' }}>
          <p className="text-[14px] text-[var(--color-text-muted)] mb-2">No sessions yet</p>
          <p className="text-[12px] text-[var(--color-text-disabled)]">
            Sessions will appear here when you start interacting with ZeRo OS
          </p>
        </div>
      ) : (
        <div className="space-y-2 animate-fade-up" style={{ animationDelay: '60ms' }}>
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => openSession(s.id)}
              className="card p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
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
