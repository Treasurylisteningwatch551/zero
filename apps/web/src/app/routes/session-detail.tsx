import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft } from '@phosphor-icons/react'
import { useUIStore } from '../stores/ui'
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
  const { selectedSessionId, setCurrentPage, setSelectedSessionId } = useUIStore()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedSessionId) return
    setLoading(true)
    apiFetch<SessionDetail>(`/api/sessions/${selectedSessionId}`)
      .then(setSession)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedSessionId])

  function goBack() {
    setSelectedSessionId(null)
    setCurrentPage('sessions')
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

  if (!selectedSessionId) {
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
        <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">
          Loading session...
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
      <div className="grid grid-cols-[1fr_380px] gap-4 mt-4" style={{ minHeight: 'calc(100vh - 280px)' }}>
        {/* Timeline */}
        <div className="overflow-y-auto pr-2" style={{ maxHeight: 'calc(100vh - 280px)' }}>
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
          selectedToolId={selectedToolId}
        />
      </div>
    </div>
  )
}
