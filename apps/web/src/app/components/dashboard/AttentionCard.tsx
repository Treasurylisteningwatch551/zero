import { useState, useEffect } from 'react'
import { Warning } from '@phosphor-icons/react'
import { apiFetch } from '../../lib/api'
import { formatTimeAgo } from '../../lib/format'

interface Notification {
  ts: string
  level: string
  source: string
  description: string
  sessionId?: string
}

const MAX_VISIBLE = 5

const levelDot: Record<string, string> = {
  warn: 'bg-amber-400',
  error: 'bg-red-400',
}

export function AttentionCard() {
  const [notifications, setNotifications] = useState<Notification[]>([])

  useEffect(() => {
    apiFetch<{ notifications: Notification[] }>('/api/notifications')
      .then((res) => setNotifications(res.notifications))
      .catch(() => {})
  }, [])

  if (notifications.length === 0) return null

  const visible = notifications.slice(0, MAX_VISIBLE)
  const hasMore = notifications.length > MAX_VISIBLE

  return (
    <div
      className="card p-5 animate-fade-up border border-amber-400/30"
      style={{ boxShadow: '0 0 20px rgba(251, 191, 36, 0.1)' }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Warning size={18} weight="fill" className="text-amber-400" />
        <h3 className="text-[14px] font-semibold text-amber-400">Needs Attention</h3>
      </div>

      <div className="space-y-2">
        {visible.map((n, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-1.5">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${levelDot[n.level] ?? 'bg-amber-400'}`}
              />
              <span className="text-[13px] text-[var(--color-text-secondary)] truncate">
                {n.description}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-[var(--color-text-muted)]">
                {n.source}
              </span>
              <span className="text-[11px] text-[var(--color-text-disabled)] w-12 text-right">
                {formatTimeAgo(n.ts)}
              </span>
              {n.sessionId && (
                <span className="text-[11px] text-[var(--color-accent)] cursor-pointer hover:underline">
                  View Session
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <p className="text-[12px] text-[var(--color-accent)] mt-3 cursor-pointer hover:underline">
          View all in Logs ({notifications.length} total)
        </p>
      )}
    </div>
  )
}
