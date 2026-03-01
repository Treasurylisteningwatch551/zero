/**
 * Get the current ISO 8601 timestamp.
 */
export function now(): string {
  return new Date().toISOString()
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) {
    const min = Math.floor(ms / 60_000)
    const sec = Math.floor((ms % 60_000) / 1000)
    return `${min}m ${sec}s`
  }
  const hours = Math.floor(ms / 3_600_000)
  const min = Math.floor((ms % 3_600_000) / 60_000)
  return `${hours}h ${min}m`
}

/**
 * Calculate the time elapsed since a given ISO timestamp, in milliseconds.
 */
export function elapsed(isoTimestamp: string): number {
  return Date.now() - new Date(isoTimestamp).getTime()
}

/**
 * Format a relative time string (e.g., "3s ago", "5m ago", "2h ago").
 */
export function timeAgo(isoTimestamp: string): string {
  const ms = elapsed(isoTimestamp)
  if (ms < 1000) return 'just now'
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}
