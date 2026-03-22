import {
  type SessionTaskClosureEvent,
  type TraceSpan,
  flattenTraceSpans,
  getTaskClosureTraceDetails,
} from './timeline'

export interface TraceEvalRequestEntry {
  id: string
  stopReason: string
  toolUseCount: number
  durationMs?: number
  cost: number
  ts: string
}

type EvalVerdict = 'resolved' | 'blocked' | 'needs_review'
type EvalConfidence = 'high' | 'medium' | 'low'
type EvalTone = 'good' | 'warn' | 'bad'

interface EvalClosureEvent {
  ts: string
  event: SessionTaskClosureEvent['event']
  action?: SessionTaskClosureEvent['action']
  reason: string
  failureStage?: SessionTaskClosureEvent['failureStage']
  assistantMessageId?: string
  assistantMessageCreatedAt?: string
}

export interface TraceEvalBreakdownItem {
  key: 'outcome' | 'execution' | 'efficiency' | 'trace_quality'
  label: string
  score: number
  maxScore: number
  note: string
}

export interface TraceEvalHighlight {
  tone: EvalTone
  text: string
}

export interface TraceEvalReport {
  score: number
  verdict: EvalVerdict
  confidence: EvalConfidence
  summary: string
  breakdown: TraceEvalBreakdownItem[]
  highlights: TraceEvalHighlight[]
  metrics: {
    turnCount: number
    llmRequestSpanCount: number
    projectedRequestCount: number
    toolCallCount: number
    toolErrorCount: number
    llmErrorCount: number
    closureCount: number
    finishCount: number
    blockCount: number
    continueCount: number
    requestCoverage: number
    avgRequestsPerTurn: number
    runningSpanCount: number
    latestAction?: SessionTaskClosureEvent['action']
    latestReason?: string
    subAgentCount: number
    subAgentSuccessRate: number
    subAgentTotalDurationMs: number
  }
}

export function evaluateTraceSession({
  traces = [],
  taskClosureEvents = [],
  llmRequests = [],
}: {
  traces?: TraceSpan[]
  taskClosureEvents?: SessionTaskClosureEvent[]
  llmRequests?: TraceEvalRequestEntry[]
}): TraceEvalReport {
  const flattened = flattenTraceSpans(traces)
  const llmRequestSpans = flattened.filter((span) => span.name === 'llm_request')
  const toolCallSpans = flattened.filter((span) => span.name.startsWith('tool:'))
  const turnSpans = flattened.filter((span) => span.name.startsWith('turn:'))
  const runningSpanCount = flattened.filter((span) => span.status === 'running').length
  const subAgentSpans = flattened.filter(
    (span) =>
      span.name === 'sub_agent' ||
      span.name.startsWith('sub_agent:') ||
      span.data?.kind === 'sub_agent' ||
      span.metadata?.kind === 'sub_agent',
  )
  const subAgentCount = subAgentSpans.length
  const subAgentSuccessCount = subAgentSpans.filter(
    (span) => span.status === 'success' || span.data?.success === true,
  ).length
  const subAgentSuccessRate = subAgentCount > 0 ? subAgentSuccessCount / subAgentCount : 0
  const subAgentTotalDurationMs = subAgentSpans.reduce(
    (sum, span) => sum + ((span.data?.durationMs as number | undefined) ?? span.durationMs ?? 0),
    0,
  )
  const llmErrorCount = llmRequestSpans.filter((span) => span.status === 'error').length
  const toolErrorCount = toolCallSpans.filter((span) => span.status === 'error').length
  const requestCoverage =
    llmRequestSpans.length > 0
      ? clamp(llmRequests.length / llmRequestSpans.length, 0, 1)
      : llmRequests.length > 0
        ? 1
        : 0
  const turnCount = Math.max(turnSpans.length, llmRequests.length > 0 ? 1 : 0)
  const avgRequestsPerTurn = llmRequests.length / Math.max(turnCount, 1)
  const closures = dedupeClosures([
    ...taskClosureEvents.map(normalizePersistedClosureEvent),
    ...flattened
      .map(normalizeTraceClosureSpan)
      .filter((item): item is EvalClosureEvent => item !== null),
  ]).sort((left, right) => getClosureTimestamp(left).localeCompare(getClosureTimestamp(right)))
  const latestClosure = closures.at(-1)
  const finishCount = closures.filter((closure) => closure.action === 'finish').length
  const blockCount = closures.filter((closure) => closure.action === 'block').length
  const continueCount = closures.filter((closure) => closure.action === 'continue').length

  const outcome = scoreOutcome(latestClosure)
  const execution = scoreExecution(toolCallSpans.length, toolErrorCount, llmErrorCount)
  const efficiency = scoreEfficiency(avgRequestsPerTurn, llmRequests.length, toolCallSpans.length)
  const traceQuality = scoreTraceQuality(requestCoverage, closures.length, runningSpanCount)
  const breakdown = [outcome, execution, efficiency, traceQuality]
  const score = breakdown.reduce((sum, item) => sum + item.score, 0)
  const verdict = inferVerdict(latestClosure, score)
  const confidence = inferConfidence(requestCoverage, closures.length, runningSpanCount)

  const highlights: TraceEvalHighlight[] = []
  if (latestClosure?.event === 'task_closure_decision' && latestClosure.action) {
    highlights.push({
      tone:
        latestClosure.action === 'finish'
          ? 'good'
          : latestClosure.action === 'block'
            ? 'warn'
            : 'warn',
      text: `Latest closure: ${latestClosure.action}${latestClosure.reason ? ` · ${latestClosure.reason}` : ''}`,
    })
  } else if (latestClosure?.event === 'task_closure_failed') {
    highlights.push({
      tone: 'bad',
      text: `Task closure failed at ${latestClosure.failureStage ?? 'unknown stage'} · ${latestClosure.reason}`,
    })
  } else if (llmRequests.length > 0) {
    highlights.push({
      tone: 'warn',
      text: 'No task closure decision found yet; score relies on execution evidence only.',
    })
  } else {
    highlights.push({
      tone: 'warn',
      text: 'Trace data is still too sparse to derive a stable score.',
    })
  }

  if (toolCallSpans.length > 0) {
    const successCount = toolCallSpans.length - toolErrorCount
    highlights.push({
      tone:
        toolErrorCount === 0
          ? 'good'
          : toolErrorCount / toolCallSpans.length <= 0.25
            ? 'warn'
            : 'bad',
      text: `Tool calls: ${successCount}/${toolCallSpans.length} succeeded${toolErrorCount > 0 ? `, ${toolErrorCount} errored` : ''}.`,
    })
  }

  if (requestCoverage < 1) {
    highlights.push({
      tone: requestCoverage >= 0.8 ? 'warn' : 'bad',
      text: `Projected request coverage: ${Math.round(requestCoverage * 100)}% (${llmRequests.length}/${llmRequestSpans.length || llmRequests.length}).`,
    })
  }

  if (runningSpanCount > 0) {
    highlights.push({
      tone: 'warn',
      text: `${runningSpanCount} trace span${runningSpanCount > 1 ? 's are' : ' is'} still running; outcome may change.`,
    })
  }

  return {
    score,
    verdict,
    confidence,
    summary: buildSummary(verdict, confidence, latestClosure),
    breakdown,
    highlights,
    metrics: {
      turnCount,
      llmRequestSpanCount: llmRequestSpans.length,
      projectedRequestCount: llmRequests.length,
      toolCallCount: toolCallSpans.length,
      toolErrorCount,
      llmErrorCount,
      closureCount: closures.length,
      finishCount,
      blockCount,
      continueCount,
      requestCoverage,
      avgRequestsPerTurn,
      runningSpanCount,
      latestAction: latestClosure?.action,
      latestReason: latestClosure?.reason,
      subAgentCount,
      subAgentSuccessRate,
      subAgentTotalDurationMs,
    },
  }
}

function normalizePersistedClosureEvent(event: SessionTaskClosureEvent): EvalClosureEvent {
  return {
    ts: event.ts,
    event: event.event,
    action: event.action,
    reason: event.reason,
    failureStage: event.failureStage,
    assistantMessageId: event.assistantMessageId,
    assistantMessageCreatedAt: event.assistantMessageCreatedAt,
  }
}

function normalizeTraceClosureSpan(span: TraceSpan): EvalClosureEvent | null {
  if (span.name !== 'task_closure_decision' && span.name !== 'task_closure_failed') return null

  const details = getTaskClosureTraceDetails(span)
  if (details.called === false) return null

  const event = details.event
  const reason = details.reason
  if (!event || !reason) return null

  return {
    ts: span.endTime ?? span.startTime,
    event,
    action: details.action,
    reason,
    failureStage: details.failureStage,
    assistantMessageId: details.assistantMessageId,
    assistantMessageCreatedAt: details.assistantMessageCreatedAt,
  }
}

function dedupeClosures(events: EvalClosureEvent[]): EvalClosureEvent[] {
  const deduped = new Map<string, EvalClosureEvent>()
  for (const event of events) {
    deduped.set(getClosureKey(event), event)
  }
  return Array.from(deduped.values())
}

function getClosureKey(event: EvalClosureEvent): string {
  return [
    event.event,
    event.action ?? '',
    event.failureStage ?? '',
    event.reason,
    event.assistantMessageId ?? '',
  ].join('|')
}

function getClosureTimestamp(event: EvalClosureEvent): string {
  return event.assistantMessageCreatedAt ?? event.ts
}

function scoreOutcome(closure: EvalClosureEvent | undefined): TraceEvalBreakdownItem {
  if (!closure) {
    return {
      key: 'outcome',
      label: 'Outcome',
      score: 14,
      maxScore: 45,
      note: 'No task-closure result yet; outcome confidence is limited.',
    }
  }

  if (closure.event === 'task_closure_failed') {
    return {
      key: 'outcome',
      label: 'Outcome',
      score: 8,
      maxScore: 45,
      note: `Task closure failed at ${closure.failureStage ?? 'unknown stage'}.`,
    }
  }

  if (closure.action === 'finish') {
    return {
      key: 'outcome',
      label: 'Outcome',
      score: 45,
      maxScore: 45,
      note: 'Latest turn is classified as completed.',
    }
  }

  if (closure.action === 'block') {
    return {
      key: 'outcome',
      label: 'Outcome',
      score: closure.reason.trim().length > 0 ? 36 : 28,
      maxScore: 45,
      note: 'Latest turn is blocked, but the trace preserves an explicit reason.',
    }
  }

  return {
    key: 'outcome',
    label: 'Outcome',
    score: 20,
    maxScore: 45,
    note: 'Latest turn still requires continuation.',
  }
}

function scoreExecution(
  toolCallCount: number,
  toolErrorCount: number,
  llmErrorCount: number,
): TraceEvalBreakdownItem {
  if (toolCallCount === 0) {
    return {
      key: 'execution',
      label: 'Execution',
      score: llmErrorCount > 0 ? 18 : 25,
      maxScore: 25,
      note:
        llmErrorCount > 0
          ? 'Model-only run, but at least one request errored.'
          : 'Model-only run with no tool failures.',
    }
  }

  const successRate = clamp((toolCallCount - toolErrorCount) / toolCallCount, 0, 1)
  const llmPenalty = Math.min(llmErrorCount * 2, 4)
  return {
    key: 'execution',
    label: 'Execution',
    score: clamp(Math.round(25 * successRate) - llmPenalty, 0, 25),
    maxScore: 25,
    note: `${toolCallCount - toolErrorCount}/${toolCallCount} tool calls succeeded.`,
  }
}

function scoreEfficiency(
  avgRequestsPerTurn: number,
  requestCount: number,
  toolCallCount: number,
): TraceEvalBreakdownItem {
  let score = 15
  if (avgRequestsPerTurn > 3) score -= 3
  if (avgRequestsPerTurn > 5) score -= 3
  if (avgRequestsPerTurn > 8) score -= 3
  if (toolCallCount > requestCount * 2 && requestCount > 0) score -= 2

  return {
    key: 'efficiency',
    label: 'Efficiency',
    score: clamp(score, 0, 15),
    maxScore: 15,
    note: `${requestCount} requests across ${Math.max(1, Math.round(requestCount / Math.max(avgRequestsPerTurn, 1)))} turn-equivalent(s).`,
  }
}

function scoreTraceQuality(
  requestCoverage: number,
  closureCount: number,
  runningSpanCount: number,
): TraceEvalBreakdownItem {
  const closureSignal = closureCount > 0 ? 1 : 0.4
  const runningSignal = runningSpanCount === 0 ? 1 : 0.5
  const score = Math.round(15 * (requestCoverage * 0.5 + closureSignal * 0.3 + runningSignal * 0.2))

  return {
    key: 'trace_quality',
    label: 'Trace Quality',
    score: clamp(score, 0, 15),
    maxScore: 15,
    note:
      runningSpanCount === 0
        ? `Coverage ${Math.round(requestCoverage * 100)}% with ${closureCount} closure event${closureCount === 1 ? '' : 's'}.`
        : `Coverage ${Math.round(requestCoverage * 100)}% with ${runningSpanCount} running span${runningSpanCount === 1 ? '' : 's'}.`,
  }
}

function inferVerdict(closure: EvalClosureEvent | undefined, score: number): EvalVerdict {
  if (closure?.event === 'task_closure_decision') {
    if (closure.action === 'finish') return 'resolved'
    if (closure.action === 'block') return 'blocked'
  }

  if (score >= 75) return 'resolved'
  return 'needs_review'
}

function inferConfidence(
  requestCoverage: number,
  closureCount: number,
  runningSpanCount: number,
): EvalConfidence {
  if (requestCoverage >= 0.9 && closureCount > 0 && runningSpanCount === 0) return 'high'
  if (requestCoverage >= 0.6) return 'medium'
  return 'low'
}

function buildSummary(
  verdict: EvalVerdict,
  confidence: EvalConfidence,
  latestClosure: EvalClosureEvent | undefined,
): string {
  const verdictLabel =
    verdict === 'resolved' ? 'Resolved' : verdict === 'blocked' ? 'Blocked' : 'Needs review'
  const suffix = latestClosure?.reason ? ` · ${latestClosure.reason}` : ''
  return `${verdictLabel} · ${confidence} confidence${suffix}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
