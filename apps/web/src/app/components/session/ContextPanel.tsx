import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { toolColors } from '../../lib/colors'
import { formatCost, formatModelHistory, formatNumber, formatTimeAgo } from '../../lib/format'
import type { PersistedTaskClosureEvent } from './timeline'

interface ModelHistoryEntry {
  model: string
  from: string
  to: string | null
}

interface ToolCallInfo {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  durationMs?: number
}

interface MemoryResult {
  id: string
  type: string
  title?: string
  snippet: string
}

interface ToolResultEntry {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
  outputSummary?: string
}

interface LlmRequestEntry {
  id: string
  turnIndex?: number
  parentId?: string
  model: string
  provider: string
  userPrompt: string
  response: string
  stopReason: string
  toolUseCount: number
  toolResults?: ToolResultEntry[]
  tokens: {
    input: number
    output: number
    cacheWrite?: number
    cacheRead?: number
  }
  cost: number
  durationMs?: number
  ts: string
}

interface TraceSpan {
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

interface Props {
  summary?: string
  systemPrompt?: string
  modelHistory: ModelHistoryEntry[]
  toolCalls: ToolCallInfo[]
  filesTouched: string[]
  totalTokens: number
  inputTokens?: number
  outputTokens?: number
  cacheWriteTokens?: number
  cacheReadTokens?: number
  effectiveInputTokens?: number
  cacheHitRate?: number
  cacheReadCost?: number
  cacheWriteCost?: number
  grossAvoidedInputCost?: number
  netSavings?: number
  llmRequests?: LlmRequestEntry[]
  selectedToolId: string | null
  traces?: TraceSpan[]
  taskClosureEvents?: PersistedTaskClosureEvent[]
  traceLoading?: boolean
  onJumpToAssistantMessage?: (messageId: string) => void
}

export function ContextPanel({
  summary,
  systemPrompt,
  modelHistory,
  toolCalls,
  filesTouched,
  totalTokens,
  inputTokens,
  outputTokens,
  cacheWriteTokens,
  cacheReadTokens,
  effectiveInputTokens,
  cacheHitRate,
  cacheReadCost,
  cacheWriteCost,
  grossAvoidedInputCost,
  netSavings,
  llmRequests = [],
  selectedToolId,
  traces = [],
  taskClosureEvents = [],
  traceLoading = false,
  onJumpToAssistantMessage,
}: Props) {
  const [tab, setTab] = useState<'summary' | 'trace'>('summary')
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [relatedMemory, setRelatedMemory] = useState<MemoryResult[]>([])

  useEffect(() => {
    if (!summary) return
    apiFetch<{ results: MemoryResult[] }>(
      `/api/memory/search?q=${encodeURIComponent(summary.slice(0, 100))}`,
    )
      .then((res) => setRelatedMemory(res.results ?? []))
      .catch(() => {})
  }, [summary])

  const selectedTool = selectedToolId ? toolCalls.find((t) => t.id === selectedToolId) : null

  const toolDist = new Map<string, number>()
  for (const tc of toolCalls) {
    toolDist.set(tc.name, (toolDist.get(tc.name) ?? 0) + 1)
  }
  const totalCalls = toolCalls.length

  const persistedTaskClosureCards = useMemo(
    () => taskClosureEvents.map(mapPersistedTaskClosureEventToCard),
    [taskClosureEvents],
  )

  const formattedNetSavings =
    netSavings === undefined
      ? undefined
      : `${netSavings >= 0 ? '+' : '-'}$${formatCost(Math.abs(netSavings))}`

  if (selectedTool) {
    return (
      <div className="card p-4 h-full min-h-0 overflow-y-auto animate-fade-up">
        <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">
          Tool Detail
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-[10px] font-semibold text-[var(--color-text-disabled)] tracking-wide">
              TOOL
            </span>
            <p
              className={`text-[13px] font-mono mt-0.5 ${toolColors[selectedTool.name.toLowerCase()] ?? 'text-slate-400'}`}
            >
              {selectedTool.name}
            </p>
          </div>
          {selectedTool.durationMs !== undefined && (
            <div>
              <span className="text-[10px] font-semibold text-[var(--color-text-disabled)] tracking-wide">
                DURATION
              </span>
              <p className="text-[12px] font-mono mt-0.5 text-[var(--color-text-secondary)]">
                {formatDuration(selectedTool.durationMs)}
              </p>
            </div>
          )}
          <div>
            <span className="text-[10px] font-semibold text-[var(--color-text-disabled)] tracking-wide">
              INPUT
            </span>
            <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] mt-1 whitespace-pre-wrap break-all bg-black/20 rounded p-2 max-h-[320px] overflow-y-auto">
              {JSON.stringify(selectedTool.input, null, 2)}
            </pre>
          </div>
          {selectedTool.result !== undefined && (
            <div>
              <span className="text-[10px] font-semibold text-[var(--color-text-disabled)] tracking-wide">
                OUTPUT
              </span>
              <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] mt-1 whitespace-pre-wrap break-all bg-black/20 rounded p-2 max-h-[400px] overflow-y-auto">
                {selectedTool.result}
              </pre>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="card p-4 h-full min-h-0 overflow-y-auto animate-fade-up">
      <div className="flex gap-2 mb-4">
        {(['summary', 'trace'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-2 py-1 rounded text-[11px] transition-colors ${
              tab === t
                ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="space-y-4">
          {summary && (
            <Section title="Summary">
              <p className="text-[12px] text-[var(--color-text-secondary)]">{summary}</p>
            </Section>
          )}

          {systemPrompt && (
            <Section title="System Prompt">
              <button
                type="button"
                onClick={() => setPromptExpanded(!promptExpanded)}
                className="text-[11px] text-[var(--color-accent)] hover:underline mb-1"
              >
                {promptExpanded ? 'Collapse' : 'Expand'} ({systemPrompt.length.toLocaleString()}{' '}
                chars)
              </button>
              {promptExpanded && (
                <pre className="text-[11px] font-mono text-[var(--color-text-muted)] whitespace-pre-wrap break-all bg-black/20 rounded p-2 max-h-[400px] overflow-y-auto mt-1">
                  {systemPrompt}
                </pre>
              )}
            </Section>
          )}

          <Section title="Model History">
            <p className="text-[12px] font-mono text-[var(--color-text-muted)]">
              {formatModelHistory(modelHistory)}
            </p>
          </Section>

          <Section title="Model Usage">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--color-text-muted)]">Total</span>
                <span className="font-mono text-[var(--color-text-secondary)]">
                  {formatNumber(totalTokens)}
                </span>
              </div>
              {inputTokens !== undefined && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-text-muted)]">Input</span>
                  <span className="font-mono text-[var(--color-text-secondary)]">
                    {formatNumber(inputTokens)}
                  </span>
                </div>
              )}
              {outputTokens !== undefined && (
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-text-muted)]">Output</span>
                  <span className="font-mono text-[var(--color-text-secondary)]">
                    {formatNumber(outputTokens)}
                  </span>
                </div>
              )}
              {inputTokens !== undefined && outputTokens !== undefined && totalTokens > 0 && (
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden flex mt-1">
                  <div
                    className="h-full bg-[var(--color-accent)] rounded-l-full"
                    style={{ width: `${(inputTokens / totalTokens) * 100}%` }}
                  />
                  <div
                    className="h-full bg-[var(--color-accent-dim)]"
                    style={{ width: `${(outputTokens / totalTokens) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </Section>

          <Section title="Cache">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--color-text-muted)]">Cache Read</span>
                <span className="font-mono text-[var(--color-text-secondary)]">
                  {formatNumber(cacheReadTokens ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--color-text-muted)]">Cache Write</span>
                <span className="font-mono text-[var(--color-text-secondary)]">
                  {formatNumber(cacheWriteTokens ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--color-text-muted)]">Effective Input</span>
                <span className="font-mono text-[var(--color-text-secondary)]">
                  {formatNumber(effectiveInputTokens ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--color-text-muted)]">Hit Rate</span>
                <span className="font-mono text-[var(--color-text-secondary)]">
                  {((cacheHitRate ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="border-t border-[var(--color-border)] pt-2 mt-2 space-y-1">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-text-muted)]">Read Cost</span>
                  <span className="font-mono text-[var(--color-text-secondary)]">
                    ${formatCost(cacheReadCost ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-text-muted)]">Write Cost</span>
                  <span className="font-mono text-[var(--color-text-secondary)]">
                    ${formatCost(cacheWriteCost ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-text-muted)]">Avoided Input Cost</span>
                  <span className="font-mono text-[var(--color-text-secondary)]">
                    ${formatCost(grossAvoidedInputCost ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-text-muted)]">Net Savings</span>
                  <span className="font-mono text-[var(--color-accent)]">
                    {formattedNetSavings ?? '$0.0000'}
                  </span>
                </div>
              </div>
            </div>
          </Section>

          {totalCalls > 0 && (
            <Section title="Tool Calls">
              <div className="space-y-1.5">
                {Array.from(toolDist.entries()).map(([name, count]) => (
                  <div key={name} className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <span
                          className={`text-[11px] font-mono ${toolColors[name.toLowerCase()] ?? 'text-slate-400'}`}
                        >
                          {name}
                        </span>
                        <span className="text-[10px] text-[var(--color-text-disabled)]">
                          {count}
                        </span>
                      </div>
                      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--color-accent)] rounded-full"
                          style={{ width: `${(count / totalCalls) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {llmRequests.length > 0 && (
            <Section title="LLM Requests">
              <div className="space-y-2">
                {llmRequests
                  .slice(-5)
                  .reverse()
                  .map((request) => (
                    <details key={request.id} className="rounded bg-white/[0.02] p-2">
                      <summary className="cursor-pointer select-none text-[11px] text-[var(--color-text-secondary)]">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate font-mono text-[var(--color-accent)]">
                            {request.model}
                          </span>
                          <span className="shrink-0 text-[10px] text-[var(--color-text-disabled)]">
                            {formatTimeAgo(request.ts)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
                          <span>${request.cost.toFixed(4)}</span>
                          <span>
                            {request.tokens.input}/{request.tokens.output} tok
                          </span>
                          <span>{request.toolUseCount} tool</span>
                          <span>
                            {request.durationMs !== undefined
                              ? `${request.durationMs}ms`
                              : request.stopReason}
                          </span>
                        </div>
                      </summary>
                      <div className="mt-2 space-y-2">
                        <TracePreview label="prompt" value={request.userPrompt} />
                        <TracePreview label="response" value={request.response} />
                      </div>
                    </details>
                  ))}
              </div>
            </Section>
          )}

          {filesTouched.length > 0 && (
            <Section title="Files Touched">
              <div className="space-y-0.5">
                {filesTouched.map((f) => (
                  <p
                    key={f}
                    className="text-[11px] font-mono text-[var(--color-text-muted)] truncate"
                  >
                    {f}
                  </p>
                ))}
              </div>
            </Section>
          )}

          {relatedMemory.length > 0 && (
            <Section title="Related Memory">
              <div className="space-y-1.5">
                {relatedMemory.slice(0, 5).map((m) => (
                  <div key={m.id} className="rounded bg-white/[0.02] p-2">
                    <span className="text-[10px] text-[var(--color-accent)] capitalize">
                      {m.type}
                    </span>
                    {m.title && (
                      <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                        {m.title}
                      </p>
                    )}
                    <p className="text-[11px] text-[var(--color-text-muted)] truncate">
                      {m.snippet}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {tab === 'trace' && (
        <div className="space-y-4">
          <Section title="Task Closure">
            {traceLoading ? (
              <p className="text-[12px] text-[var(--color-text-disabled)]">Loading trace…</p>
            ) : persistedTaskClosureCards.length === 0 ? (
              <p className="text-[12px] text-[var(--color-text-disabled)]">
                No task closure events for this session.
              </p>
            ) : (
              <div className="space-y-2">
                {persistedTaskClosureCards.map((card, index) => (
                  <PersistedTaskClosureCard
                    key={`${card.createdAt}-${index}`}
                    card={card}
                    onJumpToAssistantMessage={onJumpToAssistantMessage}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Full Trace">
            {traceLoading ? (
              <p className="text-[12px] text-[var(--color-text-disabled)]">Loading trace…</p>
            ) : traces.length === 0 ? (
              <p className="text-[12px] text-[var(--color-text-disabled)]">
                No trace spans for this session.
              </p>
            ) : (
              <div className="space-y-2">
                {traces.map((span) => (
                  <TraceTree key={span.id} span={span} depth={0} />
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  )
}

function mapPersistedTaskClosureEventToCard(event: PersistedTaskClosureEvent) {
  return {
    createdAt: event.ts,
    event: event.event,
    action: event.event === 'task_closure_decision' ? event.action : undefined,
    reason: event.reason,
    failureStage: event.event === 'task_closure_failed' ? event.failureStage : undefined,
    trimFrom: event.event === 'task_closure_decision' ? event.trimFrom : undefined,
    classifierRequest: event.classifierRequest,
    classifierResponseRaw:
      event.event === 'task_closure_failed' ? event.classifierResponseRaw : undefined,
    assistantMessageId: event.assistantMessageId,
    assistantMessageCreatedAt: event.assistantMessageCreatedAt,
    error: event.event === 'task_closure_failed' ? event.error : undefined,
  }
}

function PersistedTaskClosureCard({
  card,
  onJumpToAssistantMessage,
}: {
  card: ReturnType<typeof mapPersistedTaskClosureEventToCard>
  onJumpToAssistantMessage?: (messageId: string) => void
}) {
  return (
    <div className="rounded border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2">
          <code className="text-[11px] text-cyan-300">{card.event}</code>
          <span className="rounded px-1.5 py-0.5 text-[10px] text-cyan-200 bg-cyan-400/10">
            persisted
          </span>
        </div>
        <span className="text-[10px] font-mono text-[var(--color-text-disabled)]">
          {formatTimeAgo(card.createdAt)}
        </span>
      </div>
      <div className="space-y-1 text-[11px] text-[var(--color-text-secondary)]">
        {card.action && (
          <p>
            <span className="text-[var(--color-text-disabled)]">action:</span> {card.action}
          </p>
        )}
        {card.reason && (
          <p>
            <span className="text-[var(--color-text-disabled)]">reason:</span> {card.reason}
          </p>
        )}
        {card.failureStage && (
          <p>
            <span className="text-[var(--color-text-disabled)]">failure_stage:</span>{' '}
            {card.failureStage}
          </p>
        )}
        {card.assistantMessageId && (
          <p>
            <span className="text-[var(--color-text-disabled)]">assistant_message_id:</span>{' '}
            {card.assistantMessageId}
          </p>
        )}
        {card.assistantMessageId && onJumpToAssistantMessage && (
          <button
            type="button"
            className="text-[10px] text-[var(--color-accent)] hover:underline"
            onClick={() => {
              const assistantMessageId = card.assistantMessageId
              if (assistantMessageId) onJumpToAssistantMessage(assistantMessageId)
            }}
          >
            Jump to assistant
          </button>
        )}
        {card.error && (
          <p>
            <span className="text-[var(--color-text-disabled)]">error:</span> {card.error}
          </p>
        )}
      </div>
      {(card.classifierRequest || card.trimFrom || card.classifierResponseRaw || card.error) && (
        <details className="mt-2 rounded bg-black/15 p-2">
          <summary className="cursor-pointer text-[10px] text-[var(--color-accent)] select-none">
            Task Closure Details
          </summary>
          <div className="mt-2 space-y-2">
            {card.classifierRequest && (
              <TracePreview
                label="classifier_request"
                value={JSON.stringify(card.classifierRequest, null, 2)}
              />
            )}
            {card.trimFrom && <TracePreview label="trim_from" value={card.trimFrom} />}
            {card.classifierResponseRaw && (
              <TracePreview label="classifier_response_raw" value={card.classifierResponseRaw} />
            )}
          </div>
        </details>
      )}
    </div>
  )
}

export function TraceSummaryCard({ span }: { span: TraceSpan }) {
  const metadata = span.metadata ?? {}
  const action = typeof metadata.action === 'string' ? metadata.action : undefined
  const reason = typeof metadata.reason === 'string' ? metadata.reason : undefined
  const failureStage = typeof metadata.failureStage === 'string' ? metadata.failureStage : undefined
  const trimFrom = typeof metadata.trimFrom === 'string' ? metadata.trimFrom : undefined
  const classifierResponseRaw =
    typeof metadata.classifierResponseRaw === 'string' ? metadata.classifierResponseRaw : undefined
  const assistantMessageId =
    typeof metadata.assistantMessageId === 'string' ? metadata.assistantMessageId : undefined
  const classifierRequest = isClassifierRequest(metadata.classifierRequest)
    ? metadata.classifierRequest
    : undefined
  const error = typeof metadata.error === 'string' ? metadata.error : undefined

  return (
    <div className="rounded border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2">
          <code className="text-[11px] text-cyan-300">{span.name}</code>
          <StatusBadge status={span.status} />
        </div>
        <span className="text-[10px] font-mono text-[var(--color-text-disabled)]">
          {span.durationMs !== undefined ? `${span.durationMs}ms` : formatTimeAgo(span.startTime)}
        </span>
      </div>
      <div className="space-y-1 text-[11px] text-[var(--color-text-secondary)]">
        {action && (
          <p>
            <span className="text-[var(--color-text-disabled)]">action:</span> {action}
          </p>
        )}
        {reason && (
          <p>
            <span className="text-[var(--color-text-disabled)]">reason:</span> {reason}
          </p>
        )}
        {failureStage && (
          <p>
            <span className="text-[var(--color-text-disabled)]">failure_stage:</span> {failureStage}
          </p>
        )}
        {assistantMessageId && (
          <p>
            <span className="text-[var(--color-text-disabled)]">assistant_message_id:</span>{' '}
            {assistantMessageId}
          </p>
        )}
        {error && (
          <p>
            <span className="text-[var(--color-text-disabled)]">error:</span> {error}
          </p>
        )}
      </div>
      {(classifierRequest || trimFrom || classifierResponseRaw || error) && (
        <details className="mt-2 rounded bg-black/15 p-2">
          <summary className="cursor-pointer text-[10px] text-[var(--color-accent)] select-none">
            Task Closure Details
          </summary>
          <div className="mt-2 space-y-2">
            {classifierRequest && (
              <TracePreview
                label="classifier_request"
                value={JSON.stringify(classifierRequest, null, 2)}
              />
            )}
            {trimFrom && <TracePreview label="trim_from" value={trimFrom} />}
            {classifierResponseRaw && (
              <TracePreview label="classifier_response_raw" value={classifierResponseRaw} />
            )}
          </div>
        </details>
      )}
    </div>
  )
}

function TracePreview({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-disabled)]">
        {label}
      </div>
      <pre className="whitespace-pre-wrap break-words rounded bg-black/20 p-2 text-[10px] text-[var(--color-text-muted)]">
        {value}
      </pre>
    </div>
  )
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
}

function TraceTree({ span, depth }: { span: TraceSpan; depth: number }) {
  return (
    <div className="space-y-2">
      <div
        className="rounded border border-white/8 bg-white/[0.02] p-3"
        style={{ marginLeft: `${depth * 14}px` }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <code className="text-[11px] text-[var(--color-text-secondary)] truncate">
              {span.name}
            </code>
            <StatusBadge status={span.status} />
          </div>
          <span className="text-[10px] font-mono text-[var(--color-text-disabled)]">
            {span.durationMs !== undefined ? `${span.durationMs}ms` : 'running'}
          </span>
        </div>
        {span.metadata && Object.keys(span.metadata).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(span.metadata)
              .slice(0, 6)
              .map(([key, value]) => (
                <span
                  key={key}
                  className="rounded bg-black/20 px-2 py-1 text-[10px] text-[var(--color-text-muted)]"
                  title={`${key}: ${String(value)}`}
                >
                  {key}: {formatMetadataValue(value)}
                </span>
              ))}
          </div>
        )}
      </div>

      {span.children.map((child) => (
        <TraceTree key={child.id} span={child} depth={depth + 1} />
      ))}
    </div>
  )
}

function StatusBadge({ status }: { status: TraceSpan['status'] }) {
  const cls =
    status === 'success'
      ? 'text-emerald-300 bg-emerald-400/10'
      : status === 'error'
        ? 'text-rose-300 bg-rose-400/10'
        : 'text-amber-300 bg-amber-400/10'

  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{status}</span>
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value.length > 36 ? `${value.slice(0, 33)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return '-'
  return '…'
}

function isClassifierRequest(
  value: unknown,
): value is PersistedTaskClosureEvent['classifierRequest'] {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.system === 'string' &&
    typeof candidate.prompt === 'string' &&
    typeof candidate.maxTokens === 'number'
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-semibold text-[var(--color-text-disabled)] tracking-wide mb-1.5">
        {title.toUpperCase()}
      </h4>
      {children}
    </div>
  )
}
