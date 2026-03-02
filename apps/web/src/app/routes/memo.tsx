import { useState, useEffect, useRef, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { Skeleton, SkeletonText } from '../components/shared/Skeleton'
import { apiFetch, apiPut } from '../lib/api'

const calmFuturismTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--color-text-primary)',
    fontSize: '13px',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-content': {
    caretColor: '#22d3ee',
    padding: '12px 0',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: '#22d3ee',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(34, 211, 238, 0.15)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--color-text-disabled)',
    border: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--color-text-muted)',
  },
  '.cm-line': {
    padding: '0 8px',
  },
})

export function MemoPage() {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [wordCount, setWordCount] = useState(0)
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const contentRef = useRef(content)

  // Keep contentRef in sync
  contentRef.current = content

  const saveMemo = useCallback(async (text?: string) => {
    const toSave = text ?? contentRef.current
    setSaving(true)
    setSaveStatus('saving')
    try {
      await apiPut('/api/memo', { content: toSave })
      setSaveStatus('saved')
      setLastSaved(new Date())
    } catch {
      setSaveStatus('unsaved')
    } finally {
      setSaving(false)
    }
  }, [])

  // Debounced auto-save (5 seconds)
  const debouncedSave = useCallback((text: string) => {
    setSaveStatus('unsaved')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => saveMemo(text), 5000)
  }, [saveMemo])

  useEffect(() => {
    apiFetch<{ content: string }>('/api/memo')
      .then((res) => {
        setContent(res.content)
        setWordCount(res.content.trim().split(/\s+/).filter(Boolean).length)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  // Initialize CodeMirror
  useEffect(() => {
    if (!loaded || !editorRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString()
        setContent(text)
        setWordCount(text.trim().split(/\s+/).filter(Boolean).length)
        debouncedSave(text)
      }
    })

    const cmdSave = keymap.of([{
      key: 'Mod-s',
      run: (view) => {
        saveMemo(view.state.doc.toString())
        return true
      },
    }])

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        drawSelection(),
        highlightActiveLine(),
        markdown(),
        calmFuturismTheme,
        EditorView.lineWrapping,
        updateListener,
        cmdSave,
      ],
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function formatLastSaved() {
    if (!lastSaved) return ''
    const now = new Date()
    const diff = Math.floor((now.getTime() - lastSaved.getTime()) / 1000)
    if (diff < 5) return 'just now'
    if (diff < 60) return `${diff}s ago`
    return lastSaved.toLocaleTimeString()
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[20px] font-bold tracking-tight">Memo</h1>
        <button
          onClick={() => saveMemo()}
          disabled={saving || saveStatus === 'saved'}
          className="px-3 py-1.5 rounded-lg text-[12px] bg-[var(--color-accent)] text-[var(--color-deep-bg)] hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="card animate-fade-up overflow-hidden">
        {!loaded ? (
          <div className="p-5">
            <Skeleton className="h-4 w-48 mb-3" />
            <SkeletonText lines={8} />
          </div>
        ) : (
          <div
            ref={editorRef}
            className="min-h-[400px] [&_.cm-editor]:outline-none"
          />
        )}

        {/* Status bar */}
        {loaded && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-disabled)]">
            <span>{wordCount} words</span>
            <div className="flex items-center gap-3">
              <span className={
                saveStatus === 'saved'
                  ? 'text-emerald-400'
                  : saveStatus === 'saving'
                  ? 'text-amber-400'
                  : 'text-[var(--color-text-muted)]'
              }>
                {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'}
              </span>
              {lastSaved && (
                <span>{formatLastSaved()}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
