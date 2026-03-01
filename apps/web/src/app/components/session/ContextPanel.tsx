import { useState } from 'react'
import { formatModelHistory, formatNumber } from '../../lib/format'
import { toolColors } from '../../lib/colors'

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

interface Props {
  summary?: string
  modelHistory: ModelHistoryEntry[]
  toolCalls: ToolCallInfo[]
  filesTouched: string[]
  totalTokens: number
  selectedToolId: string | null
}

export function ContextPanel({ summary, modelHistory, toolCalls, filesTouched, totalTokens, selectedToolId }: Props) {
  const [tab, setTab] = useState<'summary' | 'trace'>('summary')

  const selectedTool = selectedToolId
    ? toolCalls.find((t) => t.id === selectedToolId)
    : null

  // Tool call distribution
  const toolDist = new Map<string, number>()
  for (const tc of toolCalls) {
    toolDist.set(tc.name, (toolDist.get(tc.name) ?? 0) + 1)
  }
  const totalCalls = toolCalls.length

  if (selectedTool) {
    return (
      <div className="card p-4 h-full overflow-y-auto animate-fade-up">
        <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">Tool Detail</h3>
        <div className="space-y-3">
          <div>
            <span className="text-[10px] font-semibold text-[var(--color-text-disabled)] tracking-wide">TOOL</span>
            <p className={`text-[13px] font-mono mt-0.5 ${toolColors[selectedTool.name.toLowerCase()] ?? 'text-slate-400'}`}>
              {selectedTool.name}
            </p>
          </div>
          <div>
            <span className="text-[10px] font-semibold text-[var(--color-text-disabled)] tracking-wide">INPUT</span>
            <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] mt-1 whitespace-pre-wrap break-all bg-black/20 rounded p-2">
              {JSON.stringify(selectedTool.input, null, 2)}
            </pre>
          </div>
          {selectedTool.result !== undefined && (
            <div>
              <span className="text-[10px] font-semibold text-[var(--color-text-disabled)] tracking-wide">OUTPUT</span>
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
    <div className="card p-4 h-full overflow-y-auto animate-fade-up">
      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(['summary', 'trace'] as const).map((t) => (
          <button
            key={t}
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
          {/* Summary */}
          {summary && (
            <Section title="Summary">
              <p className="text-[12px] text-[var(--color-text-secondary)]">{summary}</p>
            </Section>
          )}

          {/* Model History */}
          <Section title="Model History">
            <p className="text-[12px] font-mono text-[var(--color-text-muted)]">
              {formatModelHistory(modelHistory)}
            </p>
          </Section>

          {/* Token Usage */}
          <Section title="Token Usage">
            <p className="text-[12px] text-[var(--color-text-muted)]">
              {formatNumber(totalTokens)} total
            </p>
          </Section>

          {/* Tool Calls Distribution */}
          {totalCalls > 0 && (
            <Section title="Tool Calls">
              <div className="space-y-1.5">
                {Array.from(toolDist.entries()).map(([name, count]) => (
                  <div key={name} className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-[11px] font-mono ${toolColors[name.toLowerCase()] ?? 'text-slate-400'}`}>
                          {name}
                        </span>
                        <span className="text-[10px] text-[var(--color-text-disabled)]">{count}</span>
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

          {/* Files Touched */}
          {filesTouched.length > 0 && (
            <Section title="Files Touched">
              <div className="space-y-0.5">
                {filesTouched.map((f) => (
                  <p key={f} className="text-[11px] font-mono text-[var(--color-text-muted)] truncate">{f}</p>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {tab === 'trace' && (
        <div className="text-[12px] text-[var(--color-text-disabled)] text-center py-8">
          Trace panel — coming soon
        </div>
      )}
    </div>
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
