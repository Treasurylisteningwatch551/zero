/**
 * Generate a UUIDv7 (time-ordered) using Bun's built-in generator.
 */
export function generateId(): string {
  return Bun.randomUUIDv7()
}

/**
 * Generate a prefixed ID for specific entity types.
 */
export function generatePrefixedId(prefix: string): string {
  const uuid = generateId()
  return `${prefix}_${uuid}`
}

/**
 * Generate a session ID with timestamp component.
 */
export function generateSessionId(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  // Use chars 13+ from UUIDv7 (skipping timestamp bytes) to get the random portion
  const uuid = Bun.randomUUIDv7().replace(/-/g, '')
  const seq = uuid.slice(13, 21)
  return `sess_${date}_${seq}`
}
