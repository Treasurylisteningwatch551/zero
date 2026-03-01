import { generatePrefixedId, now } from '@zero-os/shared'

export interface TraceSpan {
  id: string
  parentId?: string
  sessionId: string
  name: string
  startTime: string
  endTime?: string
  durationMs?: number
  status: 'running' | 'success' | 'error'
  metadata?: Record<string, unknown>
  children: TraceSpan[]
}

/**
 * Trace recorder for tracking call chains across sessions and tools.
 */
export class Tracer {
  private spans: Map<string, TraceSpan> = new Map()
  private rootSpans: Map<string, TraceSpan> = new Map()

  /**
   * Start a new trace span.
   */
  startSpan(sessionId: string, name: string, parentId?: string): TraceSpan {
    const span: TraceSpan = {
      id: generatePrefixedId('span'),
      parentId,
      sessionId,
      name,
      startTime: now(),
      status: 'running',
      children: [],
    }

    this.spans.set(span.id, span)

    if (parentId) {
      const parent = this.spans.get(parentId)
      if (parent) {
        parent.children.push(span)
      }
    } else {
      this.rootSpans.set(span.id, span)
    }

    return span
  }

  /**
   * End a trace span.
   */
  endSpan(spanId: string, status: 'success' | 'error' = 'success', metadata?: Record<string, unknown>): void {
    const span = this.spans.get(spanId)
    if (!span) return

    span.endTime = now()
    span.durationMs = new Date(span.endTime).getTime() - new Date(span.startTime).getTime()
    span.status = status
    if (metadata) {
      span.metadata = { ...span.metadata, ...metadata }
    }
  }

  /**
   * Get a span by ID.
   */
  getSpan(spanId: string): TraceSpan | undefined {
    return this.spans.get(spanId)
  }

  /**
   * Get all root spans for a session.
   */
  getSessionTraces(sessionId: string): TraceSpan[] {
    return Array.from(this.rootSpans.values()).filter((s) => s.sessionId === sessionId)
  }

  /**
   * Export the complete trace tree for a session as a serializable object.
   */
  exportSession(sessionId: string): TraceSpan[] {
    return this.getSessionTraces(sessionId)
  }

  /**
   * Clear all spans (useful for testing or memory management).
   */
  clear(): void {
    this.spans.clear()
    this.rootSpans.clear()
  }
}
