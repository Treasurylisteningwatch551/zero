import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { toolColors } from '../../lib/colors'
import { formatModelHistory, formatNumber, formatTimeAgo } from '../../lib/format'
import { filterDuplicateTaskClosureEvents, flattenTraceSpans } from './timeline'

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
}

interface MemoryResult {
  id: string
  type: string
  title?: string
  snippet: string
}

interface LlmRequestEntry {
  id: string
  model: string
  provider: string
  userPrompt: string
  response: string
  stopReason: string
  toolUseCount: number
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

interface PersistedTaskClosureEvent {
  ts: string
  event: string
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

  const taskClosureSpans = useMemo(
    () => flattenTraceSpans(traces).filter((span) => span.name === 'task_closure_decision'),
    [traces],
  )

  const persistedTaskClosureCards = useMemo(
    () =>
      filterDuplicateTaskClosureEvents(flattenTraceSpans(traces), taskClosureEvents).map(
        mapPersistedTaskClosureEventToCard,
      ),
    [traces, taskClosureEvents],
  )

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
            ) : taskClosureSpans.length === 0 && persistedTaskClosureCards.length === 0 ? (
              <p className="text-[12px] text-[var(--color-text-disabled)]">
                No `task_closure_decision` span yet for this session.
              </p>
            ) : (
              <div className="space-y-2">
                {taskClosureSpans.map((span) => (
                  <TraceSummaryCard key={span.id} span={span} />
                ))}
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
    action: event.event === 'task_closure_skipped' ? 'skipped' : event.action,
    reason: event.reason,
    skipReason: event.skipReason,
    trimFromPreview: event.trimFromPreview,
    userMessagePreview: event.userMessagePreview,
    assistantTailPreview: event.assistantTailPreview,
    rawClassifierResponse: event.rawClassifierResponse,
    assistantMessageId: event.assistantMessageId,
    assistantMessageCreatedAt: event.assistantMessageCreatedAt,
    assistantMessagePreview: event.assistantMessagePreview,
    error: event.error,
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
          <code className="text-[11px] text-cyan-300">task_closure_event</code>
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
        {card.skipReason && (
          <p>
            <span className="text-[var(--color-text-disabled)]">skip:</span> {card.skipReason}
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
      {(card.userMessagePreview ||
        card.assistantTailPreview ||
        card.rawClassifierResponse ||
        card.trimFromPreview ||
        card.assistantMessagePreview) && (
        <details className="mt-2 rounded bg-black/15 p-2">
          <summary className="cursor-pointer text-[10px] text-[var(--color-accent)] select-none">
            Raw Decision Details
          </summary>
          <div className="mt-2 space-y-2">
            {card.assistantMessagePreview && (
              <TracePreview label="assistant_message" value={card.assistantMessagePreview} />
            )}
            {card.userMessagePreview && (
              <TracePreview label="user_message" value={card.userMessagePreview} />
            )}
            {card.assistantTailPreview && (
              <TracePreview label="assistant_tail" value={card.assistantTailPreview} />
            )}
            {card.rawClassifierResponse && (
              <TracePreview label="classifier_raw" value={card.rawClassifierResponse} />
            )}
            {card.trimFromPreview && (
              <TracePreview label="trim_from" value={card.trimFromPreview} />
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
  const skipReason = typeof metadata.skipReason === 'string' ? metadata.skipReason : undefined
  const trimFromPreview =
    typeof metadata.trimFromPreview === 'string' ? metadata.trimFromPreview : undefined
  const userMessagePreview =
    typeof metadata.userMessagePreview === 'string' ? metadata.userMessagePreview : undefined
  const assistantTailPreview =
    typeof metadata.assistantTailPreview === 'string' ? metadata.assistantTailPreview : undefined
  const rawClassifierResponse =
    typeof metadata.rawClassifierResponse === 'string' ? metadata.rawClassifierResponse : undefined
  const assistantMessageId =
    typeof metadata.assistantMessageId === 'string' ? metadata.assistantMessageId : undefined
  const assistantMessagePreview =
    typeof metadata.assistantMessagePreview === 'string'
      ? metadata.assistantMessagePreview
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
        {skipReason && (
          <p>
            <span className="text-[var(--color-text-disabled)]">skip:</span> {skipReason}
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
      {(assistantMessagePreview ||
        userMessagePreview ||
        assistantTailPreview ||
        rawClassifierResponse ||
        trimFromPreview) && (
        <details className="mt-2 rounded bg-black/15 p-2">
          <summary className="cursor-pointer text-[10px] text-[var(--color-accent)] select-none">
            Raw Decision Details
          </summary>
          <div className="mt-2 space-y-2">
            {assistantMessagePreview && (
              <TracePreview label="assistant_message" value={assistantMessagePreview} />
            )}
            {userMessagePreview && <TracePreview label="user_message" value={userMessagePreview} />}
            {assistantTailPreview && (
              <TracePreview label="assistant_tail" value={assistantTailPreview} />
            )}
            {rawClassifierResponse && (
              <TracePreview label="classifier_raw" value={rawClassifierResponse} />
            )}
            {trimFromPreview && <TracePreview label="trim_from" value={trimFromPreview} />}
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
