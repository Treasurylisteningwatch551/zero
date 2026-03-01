import { useState, useEffect } from 'react'
import { apiFetch } from '../../lib/api'
import { formatTimeAgo } from '../../lib/format'

interface Session {
  id: string
  source: string
  status: string
  currentModel: string
  createdAt: string
  summary: string
  toolCallCount: number
}

export function ActiveSessions() {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    function poll() {
      apiFetch<{ sessions: Session[] }>('/api/sessions?filter=active')
        .then((res) => setSessions(res.sessions))
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="card p-5 animate-fade-up" style={{ animationDelay: '160ms' }}>
      <h3 className="text-[14px] font-semibold mb-4 text-[var(--color-text-secondary)]">
        Active Sessions
      </h3>

      {sessions.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)] py-8 text-center">
          No active sessions
        </p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const isActive = s.status === 'active'
            return (
              <div key={s.id} className="rounded-lg bg-white/[0.02] p-3">
                <div className="flex items-center gap-2.5 mb-1">
                  <span
                    className={
                      isActive
                        ? 'animate-pulse text-cyan-400 text-[10px]'
                        : 'text-[var(--color-text-disabled)] text-[10px]'
                    }
                  >
                    {isActive ? '●' : '◌'}
                  </span>
                  <span className="text-[12px] font-mono text-[var(--color-text-primary)]">
                    {s.id.slice(0, 8)}
                  </span>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-[var(--color-text-muted)]">
                    {s.source}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
                    {s.currentModel}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-disabled)] ml-auto">
                    {formatTimeAgo(s.createdAt)}
                  </span>
                </div>
                {s.summary && (
                  <p className="text-[12px] text-[var(--color-text-muted)] ml-5 truncate">
                    {s.summary}
                  </p>
                )}
                <p className="text-[11px] text-[var(--color-text-disabled)] ml-5 mt-0.5">
                  {s.toolCallCount} tool call{s.toolCallCount !== 1 ? 's' : ''}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
