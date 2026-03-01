/**
 * Format a number with thousands separators.
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

/**
 * Format a cost in USD.
 */
export function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost >= 0.01) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(4)}`
}

/**
 * Format a relative time.
 */
export function formatTimeAgo(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime()
  if (ms < 1000) return 'just now'
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

/**
 * Format model history chain, e.g. "claude-opus → claude-sonnet"
 */
export function formatModelHistory(history: { model: string }[]): string {
  const unique: string[] = []
  for (const h of history) {
    if (unique[unique.length - 1] !== h.model) unique.push(h.model)
  }
  return unique.join(' → ')
}

/**
 * Format duration between two ISO timestamps.
 */
export function formatDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  if (ms < 0) return '0s'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

/**
 * Format ISO timestamp to time only (HH:MM).
 */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Format time range, e.g. "Today 10:00 - 10:45 (45min)"
 */
export function formatTimeRange(fromIso: string, toIso: string): string {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  const today = new Date()

  const isToday = from.toDateString() === today.toDateString()
  const prefix = isToday ? 'Today' : from.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const fromTime = from.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const toTime = to.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dur = formatDuration(fromIso, toIso)

  return `${prefix} ${fromTime} - ${toTime} (${dur})`
}

/**
 * Format uptime duration.
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}
