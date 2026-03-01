import { useState, useEffect } from 'react'
import { apiFetch, apiPut } from '../lib/api'

export function MemoPage() {
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    apiFetch<{ content: string }>('/api/memo')
      .then((res) => {
        setContent(res.content)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  async function saveMemo() {
    setSaving(true)
    try {
      await apiPut('/api/memo', { content })
    } catch {
      // Silently handle for now
    } finally {
      setSaving(false)
    }
  }

  function handleToggleEdit() {
    if (editing) {
      // Switching from Edit → Preview, auto-save
      saveMemo()
    }
    setEditing(!editing)
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[20px] font-bold tracking-tight">Memo</h1>
        <div className="flex items-center gap-2">
          {editing && (
            <button
              onClick={saveMemo}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-[12px] bg-[var(--color-accent)] text-[var(--color-deep-bg)] hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          <button
            onClick={handleToggleEdit}
            className="px-3 py-1.5 rounded-lg text-[12px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-border-hover)] transition-colors"
          >
            {editing ? 'Preview' : 'Edit'}
          </button>
        </div>
      </div>

      <div className="card p-5 animate-fade-up">
        {!loaded ? (
          <div className="text-center text-[13px] text-[var(--color-text-muted)] py-8">
            Loading...
          </div>
        ) : editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full min-h-[400px] bg-transparent text-[13px] font-mono text-[var(--color-text-primary)] resize-none outline-none"
            spellCheck={false}
          />
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <pre className="text-[13px] font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap">
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
