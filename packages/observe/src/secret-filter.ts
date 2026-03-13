import type { SecretFilter } from '@zero-os/shared'

/**
 * Wraps a SecretFilter to integrate with the observe module.
 * Filters all output text through the secret filter before writing.
 */
export function createFilteredWriter(
  filter: SecretFilter,
  writer: (text: string) => void,
): (text: string) => void {
  return (text: string) => {
    writer(filter.filter(text))
  }
}

/**
 * Creates a proxy logger that filters secrets from all log output.
 */
export function filterLogEntry<T extends Record<string, unknown>>(
  filter: SecretFilter,
  entry: T,
): T {
  const filtered = { ...entry }
  for (const [key, value] of Object.entries(filtered)) {
    if (typeof value === 'string') {
      ;(filtered as Record<string, unknown>)[key] = filter.filter(value)
    }
  }
  return filtered
}
