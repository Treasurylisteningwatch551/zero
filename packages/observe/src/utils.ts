export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function flattenTraceSpans<T extends { children?: T[] }>(traces: T[]): T[] {
  return traces.flatMap((span) => [span, ...flattenTraceSpans(span.children ?? [])])
}
