import { useState } from 'react'
import type { TraceSpan } from './timeline'

export interface SubAgentSpanCardProps {
  span: TraceSpan
  depth?: number
  onJumpToTimeline?: (agentId: string) => void
}

export function SubAgentSpanCard({
  span,
  depth = 0,
  onJumpToTimeline,
}: SubAgentSpanCardProps) {
  const [instructionOpen, setInstructionOpen] = useState(false)
  const [systemPromptOpen, setSystemPromptOpen] = useState(false)
  const [outputOpen, setOutputOpen] = useState(false)
  const [childrenOpen, setChildrenOpen] = useState(false)

  const data = span.data ?? {}
  const role = data.role as string | undefined
  const instruction = data.instruction as string | undefined
  const systemPrompt = data.systemPrompt as string | undefined
  const success = data.success as boolean | undefined
  const durationMs = (data.durationMs as number | undefined) ?? span.durationMs
  const outputSummary = data.outputSummary as string | undefined
  const agentId =
    (span.metadata?.agentId as string | undefined) ??
    (data.agentId as string | undefined) ??
    span.id

  const label = span.name.startsWith('sub_agent:')
    ? span.name.slice('sub_agent:'.length)
    : span.name === 'sub_agent'
      ? ((data.label as string | undefined) ?? agentId)
      : span.name

  const statusIcon = span.status === 'success' ? '✅' : span.status === 'error' ? '❌' : '⏳'

  return (
    <div
      className="rounded-lg border border-[#4ECDC4]/20 bg-[#4ECDC4]/[0.03]"
      style={{ marginLeft: `${depth * 14}px` }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[12px] font-mono font-semibold text-[#4ECDC4]">{label}</span>
        {role && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#4ECDC4]/10 text-[#4ECDC4]">
            {role}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[12px]" title={span.status}>
          {statusIcon}
        </span>
        {durationMs !== undefined && (
          <span className="text-[10px] font-mono text-[var(--color-text-disabled)]">
            {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        {onJumpToTimeline && (
          <button
            type="button"
            onClick={() => onJumpToTimeline(agentId)}
            className="text-[10px] text-[#4ECDC4] hover:underline"
          >
            ↗ timeline
          </button>
        )}
      </div>

      {/* Instruction */}
      {instruction && (
        <CollapsibleSection
          label="Instruction"
          open={instructionOpen}
          onToggle={() => setInstructionOpen(!instructionOpen)}
        >
          <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap break-all">
            {instruction}
          </pre>
        </CollapsibleSection>
      )}

      {/* System Prompt */}
      {systemPrompt && (
        <CollapsibleSection
          label="System Prompt"
          open={systemPromptOpen}
          onToggle={() => setSystemPromptOpen(!systemPromptOpen)}
        >
          <pre className="text-[11px] font-mono text-[var(--color-text-muted)] whitespace-pre-wrap break-all bg-black/30 rounded p-2 max-h-[400px] overflow-y-auto">
            {systemPrompt}
          </pre>
        </CollapsibleSection>
      )}

      {/* Output Summary */}
      {outputSummary && (
        <CollapsibleSection
          label="Output Summary"
          open={outputOpen}
          onToggle={() => setOutputOpen(!outputOpen)}
        >
          <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap break-all">
            {outputSummary}
          </pre>
        </CollapsibleSection>
      )}

      {/* Child Spans */}
      {span.children.length > 0 && (
        <CollapsibleSection
          label={`Child Spans (${span.children.length})`}
          open={childrenOpen}
          onToggle={() => setChildrenOpen(!childrenOpen)}
        >
          <div className="space-y-1.5 pl-2 border-l border-[#4ECDC4]/15">
            {span.children.map((child) => (
              <ChildSpanRow key={child.id} span={child} depth={0} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* success field display */}
      {success !== undefined && (
        <div className="px-3 pb-2 text-[10px] text-[var(--color-text-muted)]">
          Result: {success ? 'success' : 'failed'}
        </div>
      )}
    </div>
  )
}

function CollapsibleSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="px-3 pb-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className="flex items-center gap-1 text-[11px] font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
      >
        <span className="text-[10px]">{open ? '▾' : '▸'}</span>
        {label}
      </button>
      {open && <div className="mt-1 px-1">{children}</div>}
    </div>
  )
}

function ChildSpanRow({ span, depth }: { span: TraceSpan; depth: number }) {
  const [expanded, setExpanded] = useState(false)
  const hasChildren = span.children.length > 0

  const statusCls =
    span.status === 'success'
      ? 'text-emerald-300 bg-emerald-400/10'
      : span.status === 'error'
        ? 'text-rose-300 bg-rose-400/10'
        : 'text-amber-300 bg-amber-400/10'

  return (
    <div style={{ marginLeft: `${depth * 12}px` }}>
      <div className="flex items-center gap-2 rounded bg-white/[0.02] px-2 py-1">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-[10px]" />
        )}
        <code className="text-[10px] text-[var(--color-text-secondary)] truncate flex-1">
          {span.name}
        </code>
        <span className={`rounded px-1 py-0.5 text-[9px] ${statusCls}`}>{span.status}</span>
        {span.durationMs !== undefined && (
          <span className="text-[9px] font-mono text-[var(--color-text-disabled)]">
            {span.durationMs < 1000 ? `${span.durationMs}ms` : `${(span.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
      {expanded &&
        span.children.map((child) => <ChildSpanRow key={child.id} span={child} depth={depth + 1} />)}
    </div>
  )
}
