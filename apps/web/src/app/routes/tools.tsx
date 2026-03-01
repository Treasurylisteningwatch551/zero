import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

interface ToolInfo {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export function ToolsPage() {
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch<{ tools: ToolInfo[] }>('/api/tools')
      .then((res) => setTools(res.tools))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-[20px] font-bold tracking-tight mb-4">Tools</h1>

      {loading ? (
        <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">
          Loading tools...
        </div>
      ) : tools.length === 0 ? (
        <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">
          No tools registered
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tools.map((tool) => (
            <div key={tool.name} className="card p-5 animate-fade-up">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">
                  {tool.name}
                </span>
              </div>
              <p className="text-[13px] text-[var(--color-text-secondary)] mb-3">
                {tool.description}
              </p>
              {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                <div className="bg-white/[0.02] rounded-lg p-3">
                  <p className="text-[11px] text-[var(--color-text-muted)] tracking-wide mb-2 font-semibold">
                    PARAMETERS
                  </p>
                  <pre className="text-[11px] font-mono text-[var(--color-text-disabled)] whitespace-pre-wrap overflow-auto max-h-[200px]">
                    {JSON.stringify(tool.parameters, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
