import { useState, useEffect } from 'react'
import { Eye, EyeSlash, Plus, Trash } from '@phosphor-icons/react'
import { Skeleton, SkeletonCard } from '../components/shared/Skeleton'
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
  secrets?: { key: string; masked: string; configured: boolean }[]
}

interface ChannelConfig {
  name: string
  type: string
  status: string
  secrets: { key: string; configured: boolean }[]
  codePath: string
}

type Tab = 'models' | 'scheduler' | 'fuse' | 'secrets' | 'channels' | 'version'

const TABS: { key: Tab; label: string }[] = [
  { key: 'models', label: 'Models' },
  { key: 'scheduler', label: 'Scheduler' },
  { key: 'fuse', label: 'Fuse List' },
  { key: 'secrets', label: 'Secrets' },
  { key: 'channels', label: 'Channels' },
  { key: 'version', label: 'Version' },
]

export function ConfigPage() {
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [channels, setChannels] = useState<ChannelConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('models')
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    const p1 = apiFetch<ConfigData>('/api/config')
      .then(setConfig)
      .catch(() => {})
    const p2 = apiFetch<{ channels: ChannelConfig[] }>('/api/channels/config')
      .then((res) => setChannels(res.channels))
      .catch(() => {})
    Promise.all([p1, p2]).finally(() => setLoading(false))
  }, [])

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const providers = config?.providers ?? {}
  const models = Object.entries(providers).flatMap(([provName, prov]) =>
    Object.entries(prov.models).map(([mName, model]) => ({ provName, mName, ...model }))
  )

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-[20px] font-bold tracking-tight mb-4">Config</h1>

      {/* Tab bar */}
      <div className="flex gap-1.5 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-[13px] transition-colors ${
              tab === t.key
                ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <>
          {/* Models tab */}
          {tab === 'models' && (
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
            </div>
          )}

          {/* Scheduler tab */}
          {tab === 'scheduler' && (
            <div className="card p-5 animate-fade-up">
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
          )}

          {/* Fuse List tab */}
          {tab === 'fuse' && (
            <div className="card p-5 animate-fade-up">
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
          )}

          {/* Secrets tab */}
          {tab === 'secrets' && (
            <div className="card p-5 animate-fade-up">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[14px] font-semibold text-[var(--color-text-secondary)]">Secrets</h3>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-border-hover)] transition-colors">
                  <Plus size={14} />
                  Add Secret
                </button>
              </div>
              {config?.secrets && config.secrets.length > 0 ? (
                <div className="space-y-2">
                  {config.secrets.map((s) => (
                    <div key={s.key} className="flex items-center justify-between py-2 px-3 rounded-lg border border-[var(--color-border)]">
                      <div className="flex items-center gap-3">
                        <span className={`w-2 h-2 rounded-full ${s.configured ? 'bg-emerald-400' : 'bg-red-400'}`} />
                        <span className="text-[13px] font-mono text-[var(--color-text-primary)]">{s.key}</span>
                        <span className="text-[12px] font-mono text-[var(--color-text-disabled)]">
                          {revealedKeys.has(s.key) ? s.masked : s.masked.replace(/[^.]/g, '*').slice(0, 12) + '****'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleReveal(s.key)}
                          className="p-1.5 rounded-md hover:bg-white/[0.05] text-[var(--color-text-muted)]"
                        >
                          {revealedKeys.has(s.key) ? <EyeSlash size={14} /> : <Eye size={14} />}
                        </button>
                        <button className="p-1.5 rounded-md hover:bg-red-400/10 text-[var(--color-text-muted)] hover:text-red-400">
                          <Trash size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Show channel-derived secrets if no dedicated secrets endpoint */}
                  {channels.flatMap((ch) => ch.secrets).length > 0 ? (
                    channels.flatMap((ch) => ch.secrets).map((s) => (
                      <div key={s.key} className="flex items-center justify-between py-2 px-3 rounded-lg border border-[var(--color-border)]">
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${s.configured ? 'bg-emerald-400' : 'bg-red-400'}`} />
                          <span className="text-[13px] font-mono text-[var(--color-text-primary)]">{s.key}</span>
                          <span className="text-[12px] font-mono text-[var(--color-text-disabled)]">
                            {s.configured ? 'sk-...configured' : 'not configured'}
                          </span>
                        </div>
                        <span className={`text-[11px] px-2 py-0.5 rounded-md ${
                          s.configured ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'
                        }`}>
                          {s.configured ? 'Active' : 'Missing'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-[13px] text-[var(--color-text-muted)]">No secrets configured</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Channels tab */}
          {tab === 'channels' && (
            <div className="card p-5 animate-fade-up">
              <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Channels</h3>
              <div className="space-y-3">
                {channels.map((ch) => {
                  const isOnline = ch.status === 'online'
                  return (
                    <div
                      key={ch.name}
                      className={`flex items-center justify-between py-3 px-3 rounded-lg border ${
                        isOnline
                          ? 'border-[var(--color-border)]'
                          : 'border-red-400/30 bg-red-400/[0.05]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`}
                        />
                        <div>
                          <p className="text-[13px] text-[var(--color-text-primary)] capitalize">{ch.name}</p>
                          <p className="text-[11px] font-mono text-[var(--color-text-muted)]">{ch.codePath}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {ch.secrets.length > 0 && (
                          <div className="flex items-center gap-2">
                            {ch.secrets.map((s) => (
                              <span
                                key={s.key}
                                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                  s.configured
                                    ? 'bg-emerald-400/10 text-emerald-400'
                                    : 'bg-red-400/10 text-red-400'
                                }`}
                              >
                                {s.key}
                              </span>
                            ))}
                          </div>
                        )}
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-md ${
                            isOnline
                              ? 'bg-emerald-400/10 text-emerald-400'
                              : 'bg-red-400/10 text-red-400'
                          }`}
                        >
                          {ch.status}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {channels.length === 0 && (
                  <p className="text-[13px] text-[var(--color-text-muted)]">No channels configured</p>
                )}
              </div>
            </div>
          )}

          {/* Version tab */}
          {tab === 'version' && (
            <div className="card p-5 animate-fade-up">
              <h3 className="text-[14px] font-semibold mb-3 text-[var(--color-text-secondary)]">Version Info</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
                  <span className="text-[13px] text-[var(--color-text-muted)]">Version</span>
                  <span className="text-[13px] font-mono text-[var(--color-text-primary)]">v0.1.0</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
                  <span className="text-[13px] text-[var(--color-text-muted)]">Runtime</span>
                  <span className="text-[13px] font-mono text-[var(--color-text-primary)]">Bun</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
                  <span className="text-[13px] text-[var(--color-text-muted)]">Platform</span>
                  <span className="text-[13px] font-mono text-[var(--color-text-primary)]">macOS</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-[13px] text-[var(--color-text-muted)]">Rollback</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/[0.05] text-[var(--color-text-disabled)]">
                    Coming soon
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
