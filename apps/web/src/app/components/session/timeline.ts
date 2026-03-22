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

export interface SessionTaskClosureEvent {
  ts: string
  event: 'task_closure_decision' | 'task_closure_failed'
  sessionId?: string
  action?: 'finish' | 'continue' | 'block'
  reason: string
  classifierRequest: {
    system: string
    prompt: string
    maxTokens: number
  }
  failureStage?: 'parse_classifier_response' | 'request_classifier'
  trimFrom?: string
  classifierResponseRaw?: string
  assistantMessageId?: string
  assistantMessageCreatedAt?: string
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
  data?: Record<string, unknown>
  metadata?: Record<string, unknown>
  children: TraceSpan[]
}

interface TaskClosureTraceDetails {
  event?: SessionTaskClosureEvent['event']
  called?: boolean
  action?: SessionTaskClosureEvent['action']
  reason?: string
  failureStage?: SessionTaskClosureEvent['failureStage']
  trimFrom?: string
  classifierRequest?: SessionTaskClosureEvent['classifierRequest']
  classifierResponseRaw?: string
  assistantMessageId?: string
  assistantMessageCreatedAt?: string
  error?: string
}

export interface SubAgentChildToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  durationMs?: number
}

export type TimelineItem =
  | {
      type: 'user-message'
      text: string
      queued: boolean
      images?: Array<{ mediaType: string; data: string }>
      createdAt: string
    }
  | { type: 'agent-text'; messageId: string; text: string; model?: string; createdAt: string }
  | {
      type: 'tool-call'
      id: string
      name: string
      input: Record<string, unknown>
      result?: string
      isError?: boolean
      durationMs?: number
      createdAt: string
    }
  | { type: 'system-event'; variant: 'warning' | 'info'; text: string; createdAt: string }
  | {
      type: 'sub-agent'
      agentId: string
      label: string
      role?: string
      instruction: string
      status: 'running' | 'completed' | 'errored' | 'closed'
      output?: string
      durationMs?: number
      spawnToolCallId: string
      childToolCalls: SubAgentChildToolCall[]
      createdAt: string
    }

export function buildTimeline(
  messages: Message[],
  traces: TraceSpan[] = [],
  taskClosureEvents: SessionTaskClosureEvent[] = [],
): TimelineItem[] {
  const items: TimelineItem[] = []
  const toolResults = new Map<string, { content: string; isError: boolean }>()
  const toolDurations = extractToolDurations(traces)
  const handledSubAgentIds = new Set<string>()
  const spawnToolCallIds = new Set<string>()

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
        const isWarning =
          text.toLowerCase().includes('timeout') ||
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
      const hasToolResultBlocks = msg.content.some((b) => b.type === 'tool_result')
      if (hasToolResultBlocks && msg.messageType !== 'queued') {
        continue
      }

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
          queued: msg.messageType === 'queued',
          images: imageBlocks.length > 0 ? imageBlocks : undefined,
          createdAt: msg.createdAt,
        })
      }
      continue
    }

    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'text') {
          items.push({
            type: 'agent-text',
            messageId: msg.id,
            text: block.text as string,
            model: msg.model,
            createdAt: msg.createdAt,
          })
        } else if (block.type === 'tool_use') {
          const toolName = block.name as string
          const toolId = block.id as string
          const toolInput = (block.input as Record<string, unknown>) ?? {}
          const result = toolResults.get(toolId)

          if (toolName === 'spawn_agent') {
            const agentId =
              (result?.content ? tryParseJsonField(result.content, 'agentId') : null) ??
              (toolInput.agentId as string | undefined) ??
              toolId
            const label =
              (toolInput.label as string | undefined) ??
              (toolInput.name as string | undefined) ??
              agentId
            const role = toolInput.role as string | undefined
            const instruction = (toolInput.instruction as string | undefined) ?? ''

            const waitInfo = findWaitAgentResult(messages, agentId, toolResults)
            const childToolCalls = extractSubAgentChildToolCalls(traces, agentId)

            handledSubAgentIds.add(agentId)
            spawnToolCallIds.add(toolId)

            items.push({
              type: 'sub-agent',
              agentId,
              label,
              role,
              instruction,
              status: waitInfo?.status ?? (result?.isError ? 'errored' : 'running'),
              output: waitInfo?.output,
              durationMs: waitInfo?.durationMs ?? toolDurations.get(toolId),
              spawnToolCallId: toolId,
              childToolCalls,
              createdAt: msg.createdAt,
            })
          } else if (
            (toolName === 'wait_agent' ||
              toolName === 'close_agent' ||
              toolName === 'send_input') &&
            isHandledSubAgentTool(toolInput, handledSubAgentIds)
          ) {
            // Skip — already represented by the sub-agent block
          } else {
            items.push({
              type: 'tool-call',
              id: toolId,
              name: toolName,
              input: toolInput,
              result: result?.content,
              isError: result?.isError,
              durationMs: toolDurations.get(toolId),
              createdAt: msg.createdAt,
            })
          }
        }
      }
    }
  }

  items.push(...buildTaskClosureEvents(traces, taskClosureEvents))
  return items.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function buildTaskClosureEvents(
  traces: TraceSpan[],
  taskClosureEvents: SessionTaskClosureEvent[],
): TimelineItem[] {
  const flattenedTraces = flattenTraceSpans(traces)
  const traceItems = flattenedTraces
    .flatMap((span) => {
      if (span.name === 'task_closure_decision') {
        return [mapTaskClosureDecision(span)]
      }
      if (span.name === 'task_closure_failed') {
        return [mapTaskClosureFailed(span)]
      }
      return []
    })
    .filter((item): item is TimelineItem => item !== null)

  const sessionItems = filterDuplicateTaskClosureEvents(flattenedTraces, taskClosureEvents).map(
    mapSessionTaskClosureEvent,
  )
  return [...traceItems, ...sessionItems]
}

export function filterDuplicateTaskClosureEvents(
  traces: TraceSpan[],
  taskClosureEvents: SessionTaskClosureEvent[],
): SessionTaskClosureEvent[] {
  const traceKeys = new Set(
    traces.map(getTaskClosureTraceKey).filter((key): key is string => key !== null),
  )

  return taskClosureEvents.filter((event) => {
    const eventKey = getSessionTaskClosureEventKey(event)
    return eventKey === null || !traceKeys.has(eventKey)
  })
}

function mapSessionTaskClosureEvent(event: SessionTaskClosureEvent): TimelineItem {
  const createdAt = event.assistantMessageCreatedAt ?? event.ts

  if (event.event === 'task_closure_failed') {
    return {
      type: 'system-event',
      variant: 'warning',
      text: `Task closure failed: ${event.reason}${event.assistantMessageId ? ` · ${event.assistantMessageId.slice(0, 8)}` : ''}`,
      createdAt,
    }
  }

  const action = event.action ?? 'unknown'
  const text = event.reason
    ? `Task closure ${action}: ${event.reason}${event.assistantMessageId ? ` · ${event.assistantMessageId.slice(0, 8)}` : ''}`
    : `Task closure ${action}${event.assistantMessageId ? ` · ${event.assistantMessageId.slice(0, 8)}` : ''}`
  const variant = action === 'block' ? 'warning' : 'info'

  return {
    type: 'system-event',
    variant,
    text,
    createdAt,
  }
}

function mapTaskClosureDecision(span: TraceSpan): TimelineItem | null {
  const details = getTaskClosureTraceDetails(span)
  const createdAt = details.assistantMessageCreatedAt ?? span.endTime ?? span.startTime

  if (details.called === false) return null

  const label = details.action ?? 'unknown'
  const text = details.reason ? `Task closure ${label}: ${details.reason}` : `Task closure ${label}`
  const variant = details.action === 'block' ? 'warning' : 'info'

  return {
    type: 'system-event',
    variant,
    text,
    createdAt,
  }
}

function mapTaskClosureFailed(span: TraceSpan): TimelineItem {
  const details = getTaskClosureTraceDetails(span)
  const reason = details.reason ?? 'task closure failed'
  return {
    type: 'system-event',
    variant: 'warning',
    text: `Task closure failed: ${reason}`,
    createdAt: details.assistantMessageCreatedAt ?? span.endTime ?? span.startTime,
  }
}

export function flattenTraceSpans(traces: TraceSpan[]): TraceSpan[] {
  return traces.flatMap((span) => [span, ...flattenTraceSpans(span.children ?? [])])
}

function extractToolDurations(traces: TraceSpan[]): Map<string, number> {
  const toolDurations = new Map<string, number>()

  for (const span of flattenTraceSpans(traces)) {
    if (!span.name.startsWith('tool:') || typeof span.durationMs !== 'number') continue
    const toolUseId =
      span.metadata && typeof span.metadata.toolUseId === 'string' ? span.metadata.toolUseId : null
    if (!toolUseId) continue
    toolDurations.set(toolUseId, span.durationMs)
  }

  return toolDurations
}

function getTaskClosureTraceKey(span: TraceSpan): string | null {
  const details = getTaskClosureTraceDetails(span)
  const assistantMessageId = details.assistantMessageId ?? ''

  if (span.name === 'task_closure_decision') {
    if (details.called === false) return null

    const action = details.action ?? 'unknown'
    const reason = details.reason ?? ''
    return `decision|${action}|${reason}|${assistantMessageId}`
  }

  if (span.name === 'task_closure_failed') {
    const reason = details.reason ?? 'task_closure_failed'
    const failureStage = details.failureStage ?? 'unknown'
    return `failed|${failureStage}|${reason}|${assistantMessageId}`
  }

  return null
}

function getSessionTaskClosureEventKey(event: SessionTaskClosureEvent): string | null {
  const assistantMessageId = event.assistantMessageId ?? ''

  if (event.event === 'task_closure_decision') {
    return `decision|${event.action ?? 'unknown'}|${event.reason ?? ''}|${assistantMessageId}`
  }

  if (event.event === 'task_closure_failed') {
    return `failed|${event.failureStage ?? 'unknown'}|${event.reason ?? ''}|${assistantMessageId}`
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

export function getTaskClosureTraceDetails(span: TraceSpan): TaskClosureTraceDetails {
  const metadata = span.metadata ?? {}
  const closure = asRecord(asRecord(span.data)?.closure)
  const action = asAction(asString(closure?.action)) ?? asAction(asString(metadata.action))
  const reason = asString(closure?.reason) ?? asString(metadata.reason)

  return {
    event:
      asTaskClosureEvent(asString(closure?.event)) ??
      asTaskClosureEvent(
        span.name === 'task_closure_decision' || span.name === 'task_closure_failed'
          ? span.name
          : undefined,
      ),
    called:
      asBoolean(closure?.called) ??
      asBoolean(metadata.called) ??
      (action !== undefined || reason !== undefined ? true : undefined),
    action,
    reason,
    failureStage:
      asFailureStage(asString(closure?.failureStage)) ??
      asFailureStage(asString(metadata.failureStage)),
    trimFrom: asString(closure?.trimFrom) ?? asString(metadata.trimFrom),
    classifierRequest: resolveClassifierRequest(
      closure?.classifierRequest,
      metadata.classifierRequest,
    ),
    classifierResponseRaw:
      asString(closure?.classifierResponseRaw) ?? asString(metadata.classifierResponseRaw),
    assistantMessageId:
      asString(closure?.assistantMessageId) ?? asString(metadata.assistantMessageId),
    assistantMessageCreatedAt:
      asString(closure?.assistantMessageCreatedAt) ?? asString(metadata.assistantMessageCreatedAt),
    error: asString(closure?.error) ?? asString(metadata.error),
  }
}

function resolveClassifierRequest(
  value: unknown,
  fallback: unknown,
): SessionTaskClosureEvent['classifierRequest'] | undefined {
  if (isClassifierRequest(value)) return value
  if (isClassifierRequest(fallback)) return fallback
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asTaskClosureEvent(value: unknown): SessionTaskClosureEvent['event'] | undefined {
  return value === 'task_closure_decision' || value === 'task_closure_failed' ? value : undefined
}

function asAction(value: unknown): SessionTaskClosureEvent['action'] | undefined {
  return value === 'finish' || value === 'continue' || value === 'block' ? value : undefined
}

function asFailureStage(value: unknown): SessionTaskClosureEvent['failureStage'] | undefined {
  return value === 'parse_classifier_response' || value === 'request_classifier' ? value : undefined
}

function isClassifierRequest(
  value: unknown,
): value is SessionTaskClosureEvent['classifierRequest'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.system === 'string' &&
    typeof candidate.prompt === 'string' &&
    typeof candidate.maxTokens === 'number'
  )
}

function tryParseJsonField(json: string, field: string): string | null {
  try {
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && typeof parsed[field] === 'string') {
      return parsed[field]
    }
  } catch {
    // not valid JSON
  }
  return null
}

function findWaitAgentResult(
  messages: Message[],
  agentId: string,
  toolResults: Map<string, { content: string; isError: boolean }>,
): { status: 'completed' | 'errored' | 'closed'; output?: string; durationMs?: number } | null {
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue
      const name = block.name as string
      if (name !== 'wait_agent' && name !== 'close_agent') continue
      const input = (block.input as Record<string, unknown>) ?? {}
      const targetId = (input.agentId as string | undefined) ?? (input.agent_id as string | undefined)
      if (targetId !== agentId) continue
      const result = toolResults.get(block.id as string)
      if (!result) continue

      let status: 'completed' | 'errored' | 'closed' =
        name === 'close_agent' ? 'closed' : 'completed'
      let output: string | undefined
      let durationMs: number | undefined

      try {
        const parsed = JSON.parse(result.content)
        if (parsed && typeof parsed === 'object') {
          if (parsed.status === 'errored' || parsed.status === 'error') status = 'errored'
          else if (parsed.status === 'closed') status = 'closed'
          else if (parsed.status === 'completed') status = 'completed'
          output =
            typeof parsed.output === 'string'
              ? parsed.output
              : typeof parsed.result === 'string'
                ? parsed.result
                : undefined
          if (typeof parsed.durationMs === 'number') durationMs = parsed.durationMs
        }
      } catch {
        output = result.content
      }

      if (result.isError) status = 'errored'
      return { status, output, durationMs }
    }
  }
  return null
}

function extractSubAgentChildToolCalls(
  traces: TraceSpan[],
  agentId: string,
): SubAgentChildToolCall[] {
  const allSpans = flattenTraceSpans(traces)
  const agentSpan = allSpans.find((span) => {
    const metadata = span.metadata ?? {}
    const data = span.data ?? {}
    return (
      (span.name === 'sub_agent' || metadata.kind === 'sub_agent') &&
      (metadata.agentId === agentId || data.agentId === agentId)
    )
  })

  if (!agentSpan) return []

  const childCalls: SubAgentChildToolCall[] = []
  for (const child of flattenTraceSpans(agentSpan.children ?? [])) {
    if (!child.name.startsWith('tool:')) continue
    const meta = child.metadata ?? {}
    const data = child.data ?? {}
    childCalls.push({
      id: (meta.toolUseId as string) ?? child.id,
      name: child.name.replace('tool:', ''),
      input: (meta.input as Record<string, unknown>) ?? {},
      result: (meta.result as string) ?? (meta.outputSummary as string) ?? (data.outputSummary as string) ?? undefined,
      isError: child.status === 'error' ? true : undefined,
      durationMs: child.durationMs,
    })
  }
  return childCalls
}

function isHandledSubAgentTool(
  input: Record<string, unknown>,
  handledSubAgentIds: Set<string>,
): boolean {
  const targetId = (input.agentId as string | undefined) ?? (input.agent_id as string | undefined)
  return targetId !== undefined && handledSubAgentIds.has(targetId)
}
