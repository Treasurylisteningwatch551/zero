import { MagnifyingGlass, Play, Pause } from '@phosphor-icons/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { formatTimeAgo } from '../lib/format'

interface LogEntry {
  ts: string
  level?: string
  sessionId?: string
  session_id?: string
  tool?: string
  event?: string
  model?: string
  tokens?: { input: number; output: number }
  cost?: number
  trigger?: string
  tools?: string[]
  messagesBefore?: number
  name?: string
  status?: string
  durationMs?: number
  childCount?: number
  input?: string
  outputSummary?: string
  [key: string]: unknown
}

const levelColors: Record<string, string> = {
  info: 'text-cyan-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  debug: 'text-slate-400',
}

const levelDotColors: Record<string, string> = {
  info: 'bg-cyan-400',
  warn: 'bg-amber-400',
  error: 'bg-red-400',
}

const levelRowBg: Record<string, string> = {
  error: 'bg-red-400/[0.05]',
  warn: 'bg-amber-400/[0.05]',
}

const LOG_TYPES = ['operations', 'requests', 'snapshots', 'trace'] as const
type LogType = typeof LOG_TYPES[number]

const TIME_RANGES = [
  { label: '最近 1 小时', value: '1h' },
  { label: '最近 24 小时', value: '24h' },
  { label: '最近 7 天', value: '7d' },
] as const

interface ColumnConfig {
  cols: string
  headers: string[]
  render: (entry: LogEntry) => React.ReactNode[]
}

function getColumnConfig(type: LogType): ColumnConfig {
  switch (type) {
    case 'operations':
      return {
        cols: 'grid-cols-[90px_60px_90px_70px_1fr_1fr]',
        headers: ['Time', 'Level', 'Session', 'Tool', 'Input', 'Output'],
        render: (e) => [
          <span key="ts" className="text-[var(--color-text-disabled)] truncate">{e.ts ? formatTimeAgo(e.ts) : '-'}</span>,
          <LevelBadge key="lvl" level={e.level} />,
          <span key="sid" className="text-[var(--color-text-muted)] truncate">{getSid(e)}</span>,
          <span key="tool" className="text-[var(--color-accent)]">{e.tool ?? '-'}</span>,
          <span key="input" className="text-[var(--color-text-secondary)] truncate">{e.input ?? e.event ?? '-'}</span>,
          <span key="output" className="text-[var(--color-text-muted)] truncate">{e.outputSummary ?? '-'}</span>,
        ],
      }
    case 'requests':
      return {
        cols: 'grid-cols-[90px_60px_90px_120px_80px_80px]',
        headers: ['Time', 'Level', 'Session', 'Model', 'Tokens', 'Cost'],
        render: (e) => [
          <span key="ts" className="text-[var(--color-text-disabled)] truncate">{e.ts ? formatTimeAgo(e.ts) : '-'}</span>,
          <LevelBadge key="lvl" level={e.level} />,
          <span key="sid" className="text-[var(--color-text-muted)] truncate">{getSid(e)}</span>,
          <span key="model" className="text-[var(--color-accent)] font-mono truncate">{e.model ?? '-'}</span>,
          <span key="tokens" className="text-[var(--color-text-secondary)]">
            {e.tokens ? `${e.tokens.input}/${e.tokens.output}` : '-'}
          </span>,
          <span key="cost" className="text-[var(--color-text-muted)]">
            {e.cost !== undefined ? `$${e.cost.toFixed(4)}` : '-'}
          </span>,
        ],
      }
    case 'snapshots':
      return {
        cols: 'grid-cols-[90px_60px_90px_100px_1fr_80px]',
        headers: ['Time', 'Level', 'Session', 'Trigger', 'Tools', 'MsgBefore'],
        render: (e) => [
          <span key="ts" className="text-[var(--color-text-disabled)] truncate">{e.ts ? formatTimeAgo(e.ts) : '-'}</span>,
          <LevelBadge key="lvl" level={e.level} />,
          <span key="sid" className="text-[var(--color-text-muted)] truncate">{getSid(e)}</span>,
          <span key="trigger" className="text-[var(--color-accent)]">{e.trigger ?? '-'}</span>,
          <span key="tools" className="text-[var(--color-text-secondary)] truncate">
            {Array.isArray(e.tools) ? e.tools.join(', ') : '-'}
          </span>,
          <span key="msgBefore" className="text-[var(--color-text-muted)]">
            {e.messagesBefore ?? '-'}
          </span>,
        ],
      }
    case 'trace':
      return {
        cols: 'grid-cols-[90px_100px_1fr_90px]',
        headers: ['Time', 'Session', 'Summary', 'Duration'],
        render: (e) => [
          <span key="ts" className="text-[var(--color-text-disabled)] truncate">{e.ts ? formatTimeAgo(e.ts) : '-'}</span>,
          <span key="sid" className="text-[var(--color-text-muted)] truncate">{getSid(e)}</span>,
          <span key="name" className="text-[var(--color-text-secondary)] truncate">
            {e.name ?? '-'} {e.childCount ? `(${e.childCount} spans)` : ''}
          </span>,
          <span key="dur" className="text-[var(--color-text-muted)] font-mono">
            {e.durationMs !== undefined ? `${e.durationMs}ms` : '-'}
          </span>,
        ],
      }
  }
}

function getSid(e: LogEntry): string {
  const sid = e.sessionId ?? e.session_id ?? ''
  return typeof sid === 'string' ? sid.slice(0, 8) : '-'
}

function LevelBadge({ level }: { level?: string }) {
  if (!level) return <span className="text-slate-400">-</span>
  return <span className={levelColors[level] ?? 'text-slate-400'}>{level}</span>
}

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [levels, setLevels] = useState<Set<string>>(new Set(['info', 'warn', 'error']))
  const [logType, setLogType] = useState<LogType>('operations')
  const [timeRange, setTimeRange] = useState('1h')
  const [filterText, setFilterText] = useState('')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [isLive, setIsLive] = useState(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  const fetchLogs = useCallback((lvls: Set<string>, typ: LogType, range: string) => {
    setLoading(true)
    const params = new URLSearchParams({ type: typ, limit: '200' })

    // Time range to since
    const ms = range === '1h' ? 3_600_000 : range === '24h' ? 86_400_000 : 604_800_000
    params.set('since', new Date(Date.now() - ms).toISOString())

    // Level filter — if not all selected, pass a single level (API supports single level)
    // For multiple levels, we filter client-side
    apiFetch<{ entries: LogEntry[] }>(`/api/logs?${params}`)
      .then((res) => {
        let filtered = res.entries
        if (lvls.size < 3 && typ !== 'trace') {
          filtered = filtered.filter((e) => !e.level || lvls.has(e.level))
        }
        setEntries(filtered)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchLogs(levels, logType, timeRange)
  }, [levels, logType, timeRange, fetchLogs])

  // Live polling
  useEffect(() => {
    if (isLive) {
      pollRef.current = setInterval(() => {
        fetchLogs(levels, logType, timeRange)
      }, 3000)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isLive, levels, logType, timeRange, fetchLogs])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        filterRef.current?.focus()
      }
      if (e.key === 'Escape') {
        setExpandedRow(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  function toggleLevel(lvl: string) {
    setLevels((prev) => {
      const next = new Set(prev)
      if (next.has(lvl)) {
        if (next.size > 1) next.delete(lvl)
      } else {
        next.add(lvl)
      }
      return next
    })
  }

  const filtered = filterText
    ? entries.filter((e) => JSON.stringify(e).toLowerCase().includes(filterText.toLowerCase()))
    : entries

  const config = getColumnConfig(logType)

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-[20px] font-bold tracking-tight mb-4">Logs</h1>

      {/* Filter bar */}
      <div className="card p-4 mb-4 animate-fade-up">
        {/* Row 1: Log type tabs */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1.5">
            {LOG_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => { setLogType(t); setExpandedRow(null) }}
                className={`px-3 py-1 rounded-md text-[12px] transition-colors ${
                  logType === t
                    ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Live button */}
          <button
            onClick={() => setIsLive(!isLive)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] transition-colors ${
              isLive
                ? 'bg-cyan-400/10 text-cyan-400'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            {isLive ? <Pause size={12} weight="fill" /> : <Play size={12} weight="fill" />}
            Live
            {isLive && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
          </button>
        </div>

        {/* Row 2: Level checkboxes + Time range + Search */}
        <div className="flex items-center gap-3">
          {/* Level toggles */}
          {logType !== 'trace' && (
            <div className="flex gap-1.5">
              {(['info', 'warn', 'error'] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => toggleLevel(lvl)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors ${
                    levels.has(lvl)
                      ? 'bg-white/[0.06] text-[var(--color-text-secondary)]'
                      : 'text-[var(--color-text-disabled)]'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${levels.has(lvl) ? levelDotColors[lvl] : 'bg-slate-600'}`} />
                  {lvl}
                </button>
              ))}
            </div>
          )}

          {/* Time range */}
          <select
            className="input-field w-[140px] text-[12px]"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
          >
            {TIME_RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-disabled)]" />
            <input
              ref={filterRef}
              type="text"
              placeholder="Filter logs... (⌘F)"
              className="input-field pl-9 w-full text-[12px]"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Log table */}
      <div className="card animate-fade-up" style={{ animationDelay: '60ms' }}>
        {/* Header */}
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className={`grid ${config.cols} gap-3 text-[10px] font-semibold text-[var(--color-text-disabled)] tracking-wide`}>
            {config.headers.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="p-8 text-center text-[12px] text-[var(--color-text-muted)]">
            Loading logs...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-[var(--color-text-muted)]">
            No log entries
          </div>
        ) : (
          <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
            {filtered.map((entry, i) => {
              const rowBgClass = levelRowBg[entry.level ?? ''] ?? ''
              return (
                <div key={i}>
                  <div
                    onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                    className={`px-3 border-b border-[var(--color-border)] last:border-0 hover:bg-white/[0.03] cursor-pointer transition-colors ${rowBgClass}`}
                    style={{ height: '32px', display: 'flex', alignItems: 'center' }}
                  >
                    <div className={`grid ${config.cols} gap-3 text-[12px] font-mono w-full`}>
                      {config.render(entry)}
                    </div>
                  </div>

                  {/* Expanded detail drawer */}
                  {expandedRow === i && (
                    <div className="px-4 py-3 bg-black/20 border-b border-[var(--color-border)]">
                      <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap break-all">
                        {JSON.stringify(entry, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
