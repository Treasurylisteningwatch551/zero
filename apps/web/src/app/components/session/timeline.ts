export interface ContentBlock {
  type: string
  [key: string]: unknown
}

export interface Message {
  id: string
  role: string
  messageType: string
  content: ContentBlock[]
  model?: string
  createdAt: string
}

export interface PersistedTaskClosureEvent {
  ts: string
  event: string
  sessionId?: string
  action?: string
  reason?: string
  skipReason?: string
  trimFromPreview?: string
  userMessagePreview?: string
  assistantTailPreview?: string
  rawClassifierResponse?: string
  assistantMessageId?: string
  assistantMessageCreatedAt?: string
  assistantMessagePreview?: string
  error?: string
}

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

export type TimelineItem =
  | { type: 'user-message'; text: string; images?: Array<{ mediaType: string; data: string }>; createdAt: string }
  | { type: 'agent-text'; messageId: string; text: string; model?: string; createdAt: string }
  | { type: 'tool-call'; id: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean; createdAt: string }
  | { type: 'system-event'; variant: 'warning' | 'info'; text: string; createdAt: string }

export function buildTimeline(
  messages: Message[],
  traces: TraceSpan[] = [],
  persistedTaskClosureEvents: PersistedTaskClosureEvent[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = []
  const toolResults = new Map<string, { content: string; isError: boolean }>()

  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'system') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          toolResults.set(block.toolUseId as string, {
            content: block.content as string,
            isError: !!block.isError,
          })
        }
      }
    }
  }

  for (const msg of messages) {
    if (msg.messageType === 'notification') {
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text as string)
        .join('\n')
      if (text) {
        const isWarning = text.toLowerCase().includes('timeout') ||
          text.toLowerCase().includes('error') ||
          text.toLowerCase().includes('degrad')
        items.push({
          type: 'system-event',
          variant: isWarning ? 'warning' : 'info',
          text,
          createdAt: msg.createdAt,
        })
      }
      continue
    }

    if (msg.role === 'user') {
      const textBlocks = msg.content.filter((b) => b.type === 'text')
      const imageBlocks = msg.content
        .filter((b) => b.type === 'image')
        .map((b) => ({
          mediaType: b.mediaType as string,
          data: b.data as string,
        }))

      if (textBlocks.length > 0 || imageBlocks.length > 0) {
        const text = textBlocks.map((b) => b.text as string).join('\n')
        items.push({
          type: 'user-message',
          text,
          images: imageBlocks.length > 0 ? imageBlocks : undefined,
          createdAt: msg.createdAt,
        })
      }
      continue
    }

    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'text') {
          items.push({ type: 'agent-text', messageId: msg.id, text: block.text as string, model: msg.model, createdAt: msg.createdAt })
        } else if (block.type === 'tool_use') {
          const result = toolResults.get(block.id as string)
          items.push({
            type: 'tool-call',
            id: block.id as string,
            name: block.name as string,
            input: (block.input as Record<string, unknown>) ?? {},
            result: result?.content,
            isError: result?.isError,
            createdAt: msg.createdAt,
          })
        }
      }
    }
  }

  items.push(...buildTaskClosureEvents(traces, persistedTaskClosureEvents))
  return items.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function buildTaskClosureEvents(
  traces: TraceSpan[],
  persistedTaskClosureEvents: PersistedTaskClosureEvent[],
): TimelineItem[] {
  const flattenedTraces = flattenTraceSpans(traces)
  const traceItems = flattenedTraces
    .flatMap((span) => {
      if (span.name === 'task_closure_decision') {
        return [mapTaskClosureDecision(span)]
      }
      if (span.name === 'task_closure_trim_failed') {
        return [mapTaskClosureTrimFailed(span)]
      }
      return []
    })
    .filter((item): item is TimelineItem => item !== null)

  const persistedItems = filterDuplicateTaskClosureEvents(flattenedTraces, persistedTaskClosureEvents)
    .map(mapPersistedTaskClosureEvent)
  return [...traceItems, ...persistedItems]
}

export function filterDuplicateTaskClosureEvents(
  traces: TraceSpan[],
  persistedTaskClosureEvents: PersistedTaskClosureEvent[],
): PersistedTaskClosureEvent[] {
  const traceKeys = new Set(
    traces
      .map(getTaskClosureTraceKey)
      .filter((key): key is string => key !== null),
  )

  return persistedTaskClosureEvents.filter((event) => {
    const eventKey = getPersistedTaskClosureEventKey(event)
    return eventKey === null || !traceKeys.has(eventKey)
  })
}


function mapPersistedTaskClosureEvent(event: PersistedTaskClosureEvent): TimelineItem {
  const createdAt = event.assistantMessageCreatedAt ?? event.ts

  if (event.event === 'task_closure_skipped') {
    return {
      type: 'system-event',
      variant: 'info',
      text: `Task closure skipped: ${event.skipReason ?? 'unknown'}${event.assistantMessageId ? ` · ${event.assistantMessageId.slice(0, 8)}` : ''}`,
      createdAt,
    }
  }

  if (event.event === 'task_closure_trim_failed') {
    return {
      type: 'system-event',
      variant: 'warning',
      text: `Task closure trim failed: ${event.reason ?? 'trim_from_not_found'}`,
      createdAt,
    }
  }

  const action = event.action ?? 'unknown'
  const text = event.reason
    ? `Task closure ${action}: ${event.reason}${event.assistantMessageId ? ` · ${event.assistantMessageId.slice(0, 8)}` : ''}`
    : `Task closure ${action}${event.assistantMessageId ? ` · ${event.assistantMessageId.slice(0, 8)}` : ''}`
  const variant = action === 'block' || action === 'error' || action === 'invalid'
    ? 'warning'
    : 'info'

  return {
    type: 'system-event',
    variant,
    text,
    createdAt,
  }
}

function mapTaskClosureDecision(span: TraceSpan): TimelineItem | null {
  const metadata = span.metadata ?? {}
  const called = metadata.called === true
  const action = typeof metadata.action === 'string' ? metadata.action : undefined
  const reason = typeof metadata.reason === 'string' ? metadata.reason : undefined
  const skipReason = typeof metadata.skipReason === 'string' ? metadata.skipReason : undefined
  const assistantMessageCreatedAt = typeof metadata.assistantMessageCreatedAt === 'string'
    ? metadata.assistantMessageCreatedAt
    : undefined
  const createdAt = assistantMessageCreatedAt ?? span.endTime ?? span.startTime

  if (!called) {
    return {
      type: 'system-event',
      variant: 'info',
      text: `Task closure skipped: ${skipReason ?? 'unknown'}`,
      createdAt,
    }
  }

  const label = action ?? 'unknown'
  const text = reason
    ? `Task closure ${label}: ${reason}`
    : `Task closure ${label}`
  const variant = action === 'block' || action === 'error' || action === 'invalid'
    ? 'warning'
    : 'info'

  return {
    type: 'system-event',
    variant,
    text,
    createdAt,
  }
}

function mapTaskClosureTrimFailed(span: TraceSpan): TimelineItem {
  const metadata = span.metadata ?? {}
  const reason = typeof metadata.reason === 'string' ? metadata.reason : 'trim failed'
  const assistantMessageCreatedAt = typeof metadata.assistantMessageCreatedAt === 'string'
    ? metadata.assistantMessageCreatedAt
    : undefined
  return {
    type: 'system-event',
    variant: 'warning',
    text: `Task closure trim failed: ${reason}`,
    createdAt: assistantMessageCreatedAt ?? span.endTime ?? span.startTime,
  }
}

export function flattenTraceSpans(traces: TraceSpan[]): TraceSpan[] {
  return traces.flatMap((span) => [span, ...flattenTraceSpans(span.children ?? [])])
}

function getTaskClosureTraceKey(span: TraceSpan): string | null {
  const metadata = span.metadata ?? {}
  const assistantMessageId = typeof metadata.assistantMessageId === 'string' ? metadata.assistantMessageId : ''

  if (span.name === 'task_closure_decision') {
    if (metadata.called === false) {
      const skipReason = typeof metadata.skipReason === 'string' ? metadata.skipReason : 'unknown'
      return `decision|skipped|${skipReason}|${assistantMessageId}`
    }

    const action = typeof metadata.action === 'string' ? metadata.action : 'unknown'
    const reason = typeof metadata.reason === 'string' ? metadata.reason : ''
    return `decision|${action}|${reason}|${assistantMessageId}`
  }

  if (span.name === 'task_closure_trim_failed') {
    const reason = typeof metadata.reason === 'string' ? metadata.reason : 'trim_from_not_found'
    return `trim_failed|${reason}|${assistantMessageId}`
  }

  return null
}

function getPersistedTaskClosureEventKey(event: PersistedTaskClosureEvent): string | null {
  const assistantMessageId = event.assistantMessageId ?? ''

  if (event.event === 'task_closure_skipped') {
    return `decision|skipped|${event.skipReason ?? 'unknown'}|${assistantMessageId}`
  }

  if (event.event === 'task_closure_decision') {
    return `decision|${event.action ?? 'unknown'}|${event.reason ?? ''}|${assistantMessageId}`
  }

  if (event.event === 'task_closure_trim_failed') {
    return `trim_failed|${event.reason ?? 'trim_from_not_found'}|${assistantMessageId}`
  }

  return null
}

export function extractFilesTouched(items: TimelineItem[]): string[] {
  const files = new Set<string>()
  for (const item of items) {
    if (item.type === 'tool-call') {
      const input = item.input
      if (input.file_path && typeof input.file_path === 'string') {
        files.add(input.file_path)
      }
    }
  }
  return Array.from(files)
}
