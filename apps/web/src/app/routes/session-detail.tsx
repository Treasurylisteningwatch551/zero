import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ArrowLeft } from '@phosphor-icons/react'
import { Skeleton, SkeletonText } from '../components/shared/Skeleton'
import { useUIStore } from '../stores/ui'
import { useNavigate, useParams } from '@tanstack/react-router'
import { apiFetch } from '../lib/api'
import { MetadataBar } from '../components/session/MetadataBar'
import { TimelineView, buildTimeline, extractFilesTouched } from '../components/session/TimelineView'
import { ContextPanel } from '../components/session/ContextPanel'

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
  modelHistory: ModelHistoryEntry[]
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCost: number
  requestCount: number
}

export function SessionDetailPage() {
  const { selectedSessionId, setSelectedSessionId } = useUIStore()
  const navigate = useNavigate()
  // Try URL param first, fallback to store
  const params = useParams({ strict: false }) as { id?: string }
  const sessionId = params.id ?? selectedSessionId

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const lastKeyRef = useRef<string>('')

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    apiFetch<SessionDetail>(`/api/sessions/${sessionId}`)
      .then(setSession)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [sessionId])

  function goBack() {
    setSelectedSessionId(null)
    navigate({ to: '/sessions' })
  }

  const timelineItems = useMemo(
    () => (session ? buildTimeline(session.messages) : []),
    [session]
  )

  const toolCalls = useMemo(
    () =>
      timelineItems
        .filter((item): item is Extract<typeof item, { type: 'tool-call' }> => item.type === 'tool-call')
        .map((tc) => ({
          id: tc.id,
          name: tc.name,
          input: tc.input,
          result: tc.result,
          isError: tc.isError,
        })),
    [timelineItems]
  )

  const filesTouched = useMemo(() => extractFilesTouched(timelineItems), [timelineItems])

  // Keyboard navigation
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
      <div className="p-6 text-center text-[var(--color-text-muted)]">
        No session selected.{' '}
        <button onClick={goBack} className="text-[var(--color-accent)] underline">
          Back to sessions
        </button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <button onClick={goBack} className="flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors mb-4">
          <ArrowLeft size={16} /> Sessions
        </button>
        <Skeleton className="h-3 w-48 mb-3" />
        <div className="card p-4 mb-4">
          <div className="flex gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex-1">
                <Skeleton className="h-2.5 w-16 mb-2" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[65fr_35fr] gap-4">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-4">
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
        <button onClick={goBack} className="flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors mb-4">
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
      {/* Back button */}
      <button
        onClick={goBack}
        className="flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors mb-4"
      >
        <ArrowLeft size={16} /> Sessions
      </button>

      {/* Session ID */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-mono text-[var(--color-text-disabled)]">{session.id}</span>
      </div>

      {/* Metadata bar */}
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
      />

      {/* Content area: Timeline (left 65%) + Context panel (right 35%) */}
      <div className="grid grid-cols-[65fr_35fr] gap-4 mt-4" style={{ minHeight: 'calc(100vh - 280px)' }}>
        {/* Timeline */}
        <div ref={timelineRef} className="overflow-y-auto pr-2" style={{ maxHeight: 'calc(100vh - 280px)' }}>
          {session.messages.length === 0 ? (
            <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">
              No messages in this session.
            </div>
          ) : (
            <TimelineView
              messages={session.messages}
              selectedToolId={selectedToolId}
              onSelectTool={setSelectedToolId}
            />
          )}
        </div>

        {/* Context panel */}
        <ContextPanel
          summary={session.summary}
          modelHistory={session.modelHistory}
          toolCalls={toolCalls}
          filesTouched={filesTouched}
          totalTokens={session.totalTokens}
          inputTokens={session.inputTokens}
          outputTokens={session.outputTokens}
          selectedToolId={selectedToolId}
        />
      </div>
    </div>
  )
}
