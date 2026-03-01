import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

interface ConfigData {
  providers: Record<string, {
    apiType: string
    baseUrl: string
    models: Record<string, {
      modelId: string
      maxContext: number
      maxOutput: number
      capabilities: string[]
      tags: string[]
    }>
  }>
  defaultModel: string
  fallbackChain: string[]
  schedules: { name: string; cron: string; task: string }[]
  fuseList: { pattern: string; description: string }[]
}

export function ConfigPage() {
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch<ConfigData>('/api/config')
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <h1 className="text-[20px] font-bold tracking-tight mb-4">Config</h1>
        <div className="card p-8 text-center text-[13px] text-[var(--color-text-muted)]">Loading...</div>
      </div>
    )
  }

  const providers = config?.providers ?? {}
  const models = Object.entries(providers).flatMap(([provName, prov]) =>
    Object.entries(prov.models).map(([mName, model]) => ({ provName, mName, ...model }))
  )

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-[20px] font-bold tracking-tight mb-4">Config</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Providers */}
        <div className="card p-5 animate-fade-up">
          <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Providers</h3>
          <div className="space-y-3">
            {Object.entries(providers).map(([name, prov]) => (
              <div key={name} className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
                <div>
                  <p className="text-[13px] text-[var(--color-text-primary)]">{name}</p>
                  <p className="text-[11px] font-mono text-[var(--color-text-muted)]">{prov.apiType}</p>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-400/10 text-emerald-400">
                  Active
                </span>
              </div>
            ))}
            {Object.keys(providers).length === 0 && (
              <p className="text-[13px] text-[var(--color-text-muted)]">No providers configured</p>
            )}
          </div>
        </div>

        {/* Models */}
        <div className="card p-5 animate-fade-up" style={{ animationDelay: '60ms' }}>
          <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Models</h3>
          <div className="space-y-3">
            {models.map((m) => (
              <div key={`${m.provName}/${m.mName}`} className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
                <div>
                  <p className="text-[13px] text-[var(--color-text-primary)]">{m.mName}</p>
                  <p className="text-[11px] font-mono text-[var(--color-text-muted)]">
                    {(m.maxContext / 1000).toFixed(0)}K context / {(m.maxOutput / 1000).toFixed(0)}K output
                  </p>
                  {m.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {m.tags.map((tag) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-[var(--color-text-disabled)]">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {config?.defaultModel === m.mName && (
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-[var(--color-accent-glow)] text-[var(--color-accent)]">
                    Default
                  </span>
                )}
              </div>
            ))}
            {models.length === 0 && (
              <p className="text-[13px] text-[var(--color-text-muted)]">No models configured</p>
            )}
          </div>
        </div>

        {/* Schedules */}
        <div className="card p-5 animate-fade-up" style={{ animationDelay: '120ms' }}>
          <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Scheduled Tasks</h3>
          {config?.schedules && config.schedules.length > 0 ? (
            <div className="space-y-2">
              {config.schedules.map((s, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
                  <div>
                    <p className="text-[13px] text-[var(--color-text-primary)]">{s.name}</p>
                    <p className="text-[11px] font-mono text-[var(--color-text-muted)]">{s.cron}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-text-muted)]">No scheduled tasks configured</p>
          )}
        </div>

        {/* Fuse List */}
        <div className="card p-5 animate-fade-up" style={{ animationDelay: '180ms' }}>
          <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Fuse List</h3>
          <p className="text-[12px] text-[var(--color-text-muted)] mb-2">
            Commands blocked by the fuse list safety mechanism
          </p>
          {config?.fuseList && config.fuseList.length > 0 ? (
            <div className="space-y-1">
              {config.fuseList.map((rule, i) => (
                <div key={i} className="flex items-center gap-2 py-1">
                  <span className="text-[12px] font-mono text-red-400">{rule.pattern}</span>
                  {rule.description && (
                    <span className="text-[11px] text-[var(--color-text-disabled)]">— {rule.description}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {['rm -rf /', 'mkfs', 'dd if=/dev/zero', 'shutdown', 'reboot'].map((cmd) => (
                <div key={cmd} className="flex items-center gap-2 py-1">
                  <span className="text-[12px] font-mono text-red-400">{cmd}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
