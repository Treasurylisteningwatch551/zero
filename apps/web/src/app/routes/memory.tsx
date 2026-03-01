import { MagnifyingGlass } from '@phosphor-icons/react'
import { useState, useEffect, useRef } from 'react'
import { typeColors, typeBgColors } from '../lib/colors'
import { apiFetch } from '../lib/api'
import { formatTimeAgo } from '../lib/format'

const memoryTypes = ['session', 'incident', 'runbook', 'decision', 'note'] as const

interface MemoryItem {
  id: string
  type: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
  status: string
  confidence: number
  tags: string[]
}

export function MemoryPage() {
  const [selectedType, setSelectedType] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [selected, setSelected] = useState<MemoryItem | null>(null)
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  function fetchMemories(type: string) {
    setLoading(true)
    const params = type !== 'all' ? `?type=${type}` : ''
    apiFetch<{ memories: MemoryItem[] }>(`/api/memory${params}`)
      .then((res) => setMemories(res.memories))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  function searchMemories(q: string) {
    if (!q.trim()) {
      fetchMemories(selectedType)
      return
    }
    setLoading(true)
    apiFetch<{ results: MemoryItem[] }>(`/api/memory/search?q=${encodeURIComponent(q)}`)
      .then((res) => setMemories(res.results))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!search) fetchMemories(selectedType)
  }, [selectedType])

  function handleSearch(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchMemories(value), 300)
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <h1 className="text-[20px] font-bold tracking-tight mb-4">Memory</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
        {/* Left panel: filters + list */}
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-disabled)]" />
            <input
              type="text"
              placeholder="Search memories..."
              className="input-field pl-9 w-full"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>

          {/* Type filters */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => { setSelectedType('all'); setSearch('') }}
              className={`px-2.5 py-1 rounded-md text-[11px] tracking-wide transition-colors ${
                selectedType === 'all' ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'
              }`}
            >
              All
            </button>
            {memoryTypes.map((type) => (
              <button
                key={type}
                onClick={() => { setSelectedType(type); setSearch('') }}
                className={`px-2.5 py-1 rounded-md text-[11px] tracking-wide transition-colors ${
                  selectedType === type
                    ? `${typeBgColors[type]} ${typeColors[type]}`
                    : 'text-[var(--color-text-muted)]'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Memory list */}
          {loading ? (
            <div className="card p-6 text-center">
              <p className="text-[13px] text-[var(--color-text-muted)]">Loading...</p>
            </div>
          ) : memories.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-[13px] text-[var(--color-text-muted)]">No memories found</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
              {memories.map((mem) => (
                <button
                  key={mem.id}
                  onClick={() => setSelected(mem)}
                  className={`w-full text-left card p-3 transition-colors ${
                    selected?.id === mem.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-glow)]'
                      : 'hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeBgColors[mem.type] ?? ''} ${typeColors[mem.type] ?? 'text-slate-400'}`}>
                      {mem.type}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-disabled)]">
                      {formatTimeAgo(mem.updatedAt)}
                    </span>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-primary)] truncate">
                    {mem.title}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: detail view */}
        <div className="card p-6">
          {selected ? (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-[11px] px-2 py-0.5 rounded ${typeBgColors[selected.type] ?? ''} ${typeColors[selected.type] ?? ''}`}>
                  {selected.type}
                </span>
                <span className="text-[11px] text-[var(--color-text-disabled)]">
                  {selected.status} · confidence: {(selected.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)] mb-2">
                {selected.title}
              </h2>
              {selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {selected.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-[var(--color-text-muted)]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[13px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap">
                {selected.content}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-text-muted)] py-12 text-center">
              Select a memory to view details
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
