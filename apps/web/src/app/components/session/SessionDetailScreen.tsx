import { ArrowLeft } from '@phosphor-icons/react'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocket } from '../../hooks/useWebSocket'
import { apiFetch } from '../../lib/api'
import { useUIStore } from '../../stores/ui'
import { Skeleton, SkeletonText } from '../shared/Skeleton'
import { ContextPanel } from './ContextPanel'
import { MetadataBar } from './MetadataBar'
import { TimelineView } from './TimelineView'
import {
  type PersistedTaskClosureEvent,
  type TraceSpan,
  buildTimeline,
  extractFilesTouched,
} from './timeline'

interface ContentBlock {
  type: string
  [key: string]: unknown
}

interface Message {
  id: string
  role: string
  messageType: string
  content: ContentBlock[]
  model?: string
  createdAt: string
}

interface ModelHistoryEntry {
  model: string
  from: string
  to: string | null
}

interface SessionRequestEntry {
  id: string
  turnIndex?: number
  parentId?: string
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

interface SessionDetail {
  id: string
  source: string
  status: string
  currentModel: string
  createdAt: string
  updatedAt: string
  messages: Message[]
  tags: string[]
  summary?: string
  systemPrompt?: string
  modelHistory: ModelHistoryEntry[]
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCost: number
  requestCount: number
}

interface SessionDetailScreenProps {
  sessionId?: string | null
  headerContent?: ReactNode
  emptyState?: ReactNode
}

const DETAIL_PANE_HEIGHT = 'calc(100vh - 280px)'

export function SessionDetailScreen({
  sessionId,
  headerContent,
  emptyState,
}: SessionDetailScreenProps) {
  const { setSelectedSessionId } = useUIStore()
  const navigate = useNavigate()

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [traces, setTraces] = useState<TraceSpan[]>([])
  const [taskClosureEvents, setTaskClosureEvents] = useState<PersistedTaskClosureEvent[]>([])
  const [llmRequests, setLlmRequests] = useState<SessionRequestEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [traceLoading, setTraceLoading] = useState(true)
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [highlightedAssistantMessageId, setHighlightedAssistantMessageId] = useState<string | null>(
    null,
  )
  const timelineRef = useRef<HTMLDivElement>(null)
  const lastKeyRef = useRef<string>('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wasAtBottomRef = useRef(true)
  const previousSessionIdRef = useRef<string | null | undefined>(undefined)

  const fetchSession = useCallback(
    (showLoading = false) => {
      if (!sessionId) return Promise.resolve()
      if (showLoading) {
        setLoading(true)
        setSession(null)
        setTraces([])
        setTaskClosureEvents([])
        setLlmRequests([])
      }
      setTraceLoading(true)
      return Promise.all([
        apiFetch<SessionDetail>(`/api/sessions/${sessionId}`),
        apiFetch<{ traces: TraceSpan[] }>(`/api/sessions/${sessionId}/traces`),
        apiFetch<{ events: PersistedTaskClosureEvent[] }>(
          `/api/sessions/${sessionId}/task-closure-events`,
        ),
        apiFetch<{ requests: SessionRequestEntry[] }>(`/api/sessions/${sessionId}/requests`),
      ])
        .then(([data, traceResponse, taskClosureResponse, requestResponse]) => {
          setSession(data)
          setTraces(traceResponse.traces ?? [])
          setTaskClosureEvents(taskClosureResponse.events ?? [])
          setLlmRequests(requestResponse.requests ?? [])
          if (wasAtBottomRef.current) {
            requestAnimationFrame(() => {
              const el = timelineRef.current
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
            })
          }
        })
        .catch(() => {})
        .finally(() => {
          setTraceLoading(false)
          if (showLoading) setLoading(false)
        })
    },
    [sessionId],
  )

  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return
    previousSessionIdRef.current = sessionId
    setSelectedToolId(null)
    setHighlightedAssistantMessageId(null)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    void fetchSession(true)
  }, [sessionId, fetchSession])

  useEffect(() => {
    if (!session?.id) return
    const el = timelineRef.current
    if (!el) return
    function onScroll() {
      if (!el) return
      wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [session?.id])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const onEvent = useCallback(
    (_: string, data: unknown) => {
      const ev = data as { sessionId?: string }
      if (ev?.sessionId !== sessionId) return
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(fetchSession, 300)
    },
    [sessionId, fetchSession],
  )

  useWebSocket({
    url: `ws://${window.location.host}/ws`,
    topics: ['session:update', 'session:end', 'tool:call', 'tool:result'],
    onEvent,
  })

  function goBack() {
    setSelectedSessionId(null)
    navigate({ to: '/sessions' })
  }

  const timelineItems = useMemo(
    () => (session ? buildTimeline(session.messages, traces, taskClosureEvents) : []),
    [session, traces, taskClosureEvents],
  )

  const toolCalls = useMemo(
    () =>
      timelineItems
        .filter(
          (item): item is Extract<typeof item, { type: 'tool-call' }> => item.type === 'tool-call',
        )
        .map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
          result: toolCall.result,
          isError: toolCall.isError,
        })),
    [timelineItems],
  )

  const filesTouched = useMemo(() => extractFilesTouched(timelineItems), [timelineItems])

  const jumpToAssistantMessage = useCallback((messageId: string) => {
    setHighlightedAssistantMessageId(messageId)

    requestAnimationFrame(() => {
      const container = timelineRef.current
      const target = container?.querySelector(
        `[data-assistant-message-id="${messageId}"]`,
      ) as HTMLElement | null
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [])

  useEffect(() => {
    if (!highlightedAssistantMessageId) return
    const timer = setTimeout(() => setHighlightedAssistantMessageId(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightedAssistantMessageId])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const el = timelineRef.current
    if (!el) return

    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

    const scrollAmount = 60

    if (e.key === 'j') {
      el.scrollBy({ top: scrollAmount, behavior: 'smooth' })
    } else if (e.key === 'k') {
      el.scrollBy({ top: -scrollAmount, behavior: 'smooth' })
    } else if (e.key === 'Escape') {
      setSelectedToolId(null)
    } else if (e.key === 'g' && lastKeyRef.current === 'g') {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    } else if (e.key === 'G') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }

    lastKeyRef.current = e.key
  }, [])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!sessionId) {
    return (
      emptyState ?? (
        <div className="p-6 text-center text-[var(--color-text-muted)]">
          No session selected.{' '}
          <button type="button" onClick={goBack} className="text-[var(--color-accent)] underline">
            Back to sessions
          </button>
        </div>
      )
    )
  }

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors mb-4"
        >
          <ArrowLeft size={16} /> Sessions
        </button>
        <Skeleton className="h-3 w-48 mb-3" />
        <div className="card p-4 mb-4">
          <div className="flex gap-4">
            {Array.from({ length: 6 }, (_, index) => `session-metadata-${index}`).map((key) => (
              <div key={key} className="flex-1">
                <Skeleton className="h-2.5 w-16 mb-2" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[65fr_35fr] gap-4">
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, index) => `session-message-${index}`).map((key) => (
              <div key={key} className="card p-4">
                <Skeleton className="h-3 w-20 mb-2" />
                <SkeletonText lines={2} />
              </div>
            ))}
          </div>
          <div className="card p-4">
            <Skeleton className="h-4 w-32 mb-3" />
            <SkeletonText lines={5} />
          </div>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors mb-4"
        >
          <ArrowLeft size={16} /> Sessions
        </button>
        <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">
          Session not found.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <button
        type="button"
        onClick={goBack}
        className="flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors mb-4"
      >
        <ArrowLeft size={16} /> Sessions
      </button>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[11px] font-mono text-[var(--color-text-disabled)]">
          {session.id}
        </span>
        {headerContent}
      </div>

      <MetadataBar
        sessionId={session.id}
        summary={session.summary}
        source={session.source}
        createdAt={session.createdAt}
        updatedAt={session.updatedAt}
        modelHistory={session.modelHistory}
        requestCount={session.requestCount}
        totalTokens={session.totalTokens}
        inputTokens={session.inputTokens}
        outputTokens={session.outputTokens}
        totalCost={session.totalCost}
        onArchived={goBack}
        onDeleted={goBack}
      />

      <div
        className="grid grid-cols-[65fr_35fr] gap-4 mt-4 min-h-0 items-stretch"
        style={{ height: DETAIL_PANE_HEIGHT }}
      >
        <div ref={timelineRef} className="min-h-0 overflow-y-auto pr-2">
          {session.messages.length === 0 ? (
            <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">
              No messages in this session.
            </div>
          ) : (
            <TimelineView
              messages={session.messages}
              traces={traces}
              taskClosureEvents={taskClosureEvents}
              selectedToolId={selectedToolId}
              highlightedAssistantMessageId={highlightedAssistantMessageId}
              onSelectTool={setSelectedToolId}
            />
          )}
        </div>

        <ContextPanel
          summary={session.summary}
          systemPrompt={session.systemPrompt}
          modelHistory={session.modelHistory}
          toolCalls={toolCalls}
          filesTouched={filesTouched}
          totalTokens={session.totalTokens}
          inputTokens={session.inputTokens}
          outputTokens={session.outputTokens}
          llmRequests={llmRequests}
          selectedToolId={selectedToolId}
          traces={traces}
          taskClosureEvents={taskClosureEvents}
          traceLoading={traceLoading}
          onJumpToAssistantMessage={jumpToAssistantMessage}
        />
      </div>
    </div>
  )
}
