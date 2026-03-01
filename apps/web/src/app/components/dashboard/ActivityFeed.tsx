import { useState, useEffect, useCallback } from 'react'
import { formatTimeAgo } from '../../lib/format'
import { apiFetch } from '../../lib/api'
import { useWebSocket } from '../../hooks/useWebSocket'

interface LogEntry {
  ts: string
  sessionId?: string
  session_id?: string
  tool?: string
  event?: string
  level?: string
}

const typeColors: Record<string, string> = {
  tool: 'text-[var(--color-accent)]',
  system: 'text-amber-400',
  repair: 'text-amber-400',
  version: 'text-slate-500',
}

function entryType(entry: LogEntry): string {
  if (entry.tool) return 'tool'
  if (entry.event?.includes('repair')) return 'repair'
  return 'system'
}

const MAX_ITEMS = 20

export function ActivityFeed() {
  const [items, setItems] = useState<LogEntry[]>([])

  // Initial HTTP fetch
  useEffect(() => {
    apiFetch<{ entries: LogEntry[] }>('/api/logs?limit=20&type=operations')
      .then((res) => setItems(res.entries))
      .catch(() => {})
  }, [])

  // WebSocket real-time updates
  const onEvent = useCallback((topic: string, data: unknown) => {
    const entry = data as LogEntry
    if (!entry) return

    // Map bus events to LogEntry-compatible format
    const logEntry: LogEntry = {
      ts: new Date().toISOString(),
      event: topic,
      ...entry,
    }

    setItems((prev) => [logEntry, ...prev].slice(0, MAX_ITEMS))
  }, [])

  useWebSocket({
    url: `ws://${window.location.host}/ws`,
    topics: ['tool:*', 'session:*', 'repair:*', 'fuse:*'],
    onEvent,
  })

  if (items.length === 0) {
    return (
      <div className="card p-5 animate-fade-up" style={{ animationDelay: '240ms' }}>
        <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text-secondary)]">
          Recent Activity
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)] py-8 text-center">
          No activity yet. Start a conversation to see events here.
        </p>
      </div>
    )
  }

  return (
    <div className="card p-5 animate-fade-up" style={{ animationDelay: '240ms' }}>
      <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text-secondary)]">
        Recent Activity
      </h3>
      <div className="space-y-1">
        {items.map((item, i) => {
          const type = entryType(item)
          const sid = item.sessionId ?? item.session_id ?? ''
          return (
            <div
              key={i}
              className={`flex items-center gap-3 py-1.5 text-[12px] font-mono${
                i === 0 ? ' animate-fade-up' : ''
              }`}
            >
              <span className="text-[var(--color-text-disabled)] w-12">
                {item.ts ? formatTimeAgo(item.ts) : '-'}
              </span>
              <span className="text-[var(--color-text-muted)] w-20 truncate">
                {typeof sid === 'string' ? sid.slice(0, 8) : '-'}
              </span>
              <span className={typeColors[type] ?? 'text-[var(--color-text-muted)]'}>
                {item.tool ?? type}
              </span>
              <span className="text-[var(--color-text-secondary)] flex-1 truncate">
                {item.event ?? ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
