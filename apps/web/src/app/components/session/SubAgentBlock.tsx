import {
  CaretDown,
  CaretRight,
  CheckCircle,
  Clock,
  Robot,
  Spinner,
  XCircle,
} from '@phosphor-icons/react'
import { useState } from 'react'

export interface SubAgentChildToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  durationMs?: number
}

export interface SubAgentBlockProps {
  agentId: string
  label: string
  role?: string
  instruction: string
  status: 'running' | 'completed' | 'errored' | 'closed'
  output?: string
  durationMs?: number
  childToolCalls?: SubAgentChildToolCall[]
  selected?: boolean
  onSelect?: (id: string) => void
}

const statusBorderColor: Record<SubAgentBlockProps['status'], string> = {
  running: 'border-l-blue-400',
  completed: 'border-l-emerald-400',
  errored: 'border-l-red-400',
  closed: 'border-l-slate-500',
}

const statusLabel: Record<SubAgentBlockProps['status'], string> = {
  running: 'Running',
  completed: 'Completed',
  errored: 'Error',
  closed: 'Closed',
}

const statusTextColor: Record<SubAgentBlockProps['status'], string> = {
  running: 'text-blue-400',
  completed: 'text-emerald-400',
  errored: 'text-red-400',
  closed: 'text-slate-500',
}

export function SubAgentBlock({
  agentId,
  label,
  role,
  instruction,
  status,
  output,
  durationMs,
  childToolCalls,
  selected,
  onSelect,
}: SubAgentBlockProps) {
  const [instructionExpanded, setInstructionExpanded] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)
  const [childrenExpanded, setChildrenExpanded] = useState(false)

  const borderColor = statusBorderColor[status]
  const handleSelect = () => onSelect?.(agentId)

  return (
    <div
      className={`rounded-lg border-l-2 border border-white/[0.06] transition-colors cursor-pointer ${borderColor} ${
        selected ? 'bg-white/[0.04]' : 'bg-white/[0.03] hover:bg-white/[0.05]'
      } ${status === 'running' ? 'animate-pulse' : ''}`}
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleSelect()
        }
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Robot size={14} weight="bold" className="text-teal-400" />
        <span className="text-[12px] font-mono font-semibold text-teal-400">{label}</span>
        {role && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-teal-400/10 text-teal-400">
            {role}
          </span>
        )}
        <span className="flex-1" />
        {status === 'running' ? (
          <Spinner size={14} weight="bold" className="text-blue-400 animate-spin" />
        ) : status === 'completed' ? (
          <CheckCircle size={14} weight="fill" className="text-emerald-400" />
        ) : status === 'errored' ? (
          <XCircle size={14} weight="fill" className="text-red-400" />
        ) : null}
        <span className={`text-[10px] font-mono ${statusTextColor[status]}`}>
          {statusLabel[status]}
        </span>
        {durationMs !== undefined && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--color-text-disabled)] font-mono">
            <Clock size={10} />
            {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>

      {/* Instruction (collapsible) */}
      <div className="px-3 pb-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setInstructionExpanded(!instructionExpanded)
          }}
          className="flex items-center gap-1 text-[11px] font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
        >
          {instructionExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
          Instruction
        </button>
        {instructionExpanded && (
          <div className="mt-1 px-3 max-h-[200px] overflow-y-auto">
            <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap break-all">
              {instruction}
            </pre>
          </div>
        )}
      </div>

      {/* Child tool calls */}
      {childToolCalls && childToolCalls.length > 0 && (
        <div className="px-3 pb-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setChildrenExpanded(!childrenExpanded)
            }}
            className="flex items-center gap-1 text-[11px] font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          >
            {childrenExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
            Tool calls ({childToolCalls.length})
          </button>
          {childrenExpanded && (
            <div className="mt-1 pl-3 space-y-1 border-l border-white/[0.06]">
              {childToolCalls.map((tc) => (
                <ChildToolCallItem key={tc.id} tc={tc} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Output (collapsible, no max-height limit) */}
      {output && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOutputExpanded(!outputExpanded)
            }}
            className="flex items-center gap-1 text-[11px] font-mono text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          >
            {outputExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
            Output
          </button>
          {outputExpanded && (
            <>
              <div className="border-t border-white/[0.06] mx-0 mt-1" />
              <div className="mt-1 max-h-[600px] overflow-y-auto">
                <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap break-words">
                  {output}
                </pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Expandable child tool call — shows name/duration in header, input/result on expand */
function ChildToolCallItem({ tc }: { tc: SubAgentChildToolCall }) {
  const [expanded, setExpanded] = useState(false)

  const inputSummary = formatInputSummary(tc.input)

  return (
    <div className="rounded bg-white/[0.02]">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setExpanded(!expanded)
        }}
        className="flex items-center gap-2 px-2 py-1 w-full text-left hover:bg-white/[0.03] rounded"
      >
        {expanded ? <CaretDown size={8} className="text-slate-500 shrink-0" /> : <CaretRight size={8} className="text-slate-500 shrink-0" />}
        <span className="text-[10px] font-mono font-semibold text-slate-400">
          {tc.name}
        </span>
        {inputSummary && (
          <span className="text-[9px] font-mono text-[var(--color-text-disabled)] truncate max-w-[300px]">
            {inputSummary}
          </span>
        )}
        <span className="flex-1" />
        {tc.isError ? (
          <XCircle size={10} weight="fill" className="text-red-400 shrink-0" />
        ) : tc.isError === false ? (
          <CheckCircle size={10} weight="fill" className="text-emerald-400 shrink-0" />
        ) : null}
        {tc.durationMs !== undefined && (
          <span className="text-[9px] text-[var(--color-text-disabled)] font-mono shrink-0">
            {tc.durationMs < 1000
              ? `${tc.durationMs}ms`
              : `${(tc.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-2 space-y-1.5">
          {Object.keys(tc.input).length > 0 && (
            <div>
              <div className="text-[9px] font-mono text-[var(--color-text-disabled)] uppercase tracking-wide mb-0.5">Input</div>
              <pre className="text-[10px] font-mono text-[var(--color-text-secondary)] bg-black/20 rounded px-2 py-1.5 max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words">
                {formatInput(tc.input)}
              </pre>
            </div>
          )}
          {tc.result && (
            <div>
              <div className="text-[9px] font-mono text-[var(--color-text-disabled)] uppercase tracking-wide mb-0.5">Result</div>
              <pre className={`text-[10px] font-mono rounded px-2 py-1.5 max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words ${
                tc.isError ? 'text-red-400/80 bg-red-400/5' : 'text-[var(--color-text-secondary)] bg-black/20'
              }`}>
                {tc.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Short inline summary of tool input for the collapsed header */
function formatInputSummary(input: Record<string, unknown>): string {
  if ('command' in input) return String(input.command).slice(0, 80)
  if ('path' in input) return String(input.path)
  if ('url' in input) return String(input.url).slice(0, 80)
  if ('instruction' in input) return String(input.instruction).slice(0, 60)
  if ('query' in input) return String(input.query).slice(0, 60)
  const first = Object.values(input)[0]
  if (typeof first === 'string') return first.slice(0, 60)
  return ''
}

/** Pretty-format tool input for the expanded view */
function formatInput(input: Record<string, unknown>): string {
  // For simple single-field inputs, show just the value
  const keys = Object.keys(input)
  if (keys.length === 1 && typeof input[keys[0]] === 'string') {
    return input[keys[0]] as string
  }
  // For multi-field, show as compact YAML-ish format
  return keys
    .map((k) => {
      const v = input[k]
      if (typeof v === 'string') {
        return v.includes('\n') ? `${k}:\n${v}` : `${k}: ${v}`
      }
      return `${k}: ${JSON.stringify(v)}`
    })
    .join('\n')
}
