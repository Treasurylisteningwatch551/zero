import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { Eye, PencilSimple, SplitHorizontal } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Skeleton, SkeletonText } from '../components/shared/Skeleton'
import { apiFetch, apiPut } from '../lib/api'

type ViewMode = 'edit' | 'split' | 'preview'

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

const VIEW_MODES: { key: ViewMode; icon: typeof PencilSimple; label: string }[] = [
  { key: 'edit', icon: PencilSimple, label: '编辑' },
  { key: 'split', icon: SplitHorizontal, label: '分屏' },
  { key: 'preview', icon: Eye, label: '预览' },
]

export function MemoPage() {
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [wordCount, setWordCount] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const contentRef = useRef(content)
  const saveMemoRef = useRef<(text?: string) => Promise<void>>(async () => {})
  const debouncedSaveRef = useRef<(text: string) => void>(() => {})

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
  const debouncedSave = useCallback(
    (text: string) => {
      setSaveStatus('unsaved')
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => saveMemo(text), 5000)
    },
    [saveMemo],
  )
  saveMemoRef.current = saveMemo
  debouncedSaveRef.current = debouncedSave

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
    if (!loaded || !editorRef.current || viewMode === 'preview') return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString()
        setContent(text)
        setWordCount(text.trim().split(/\s+/).filter(Boolean).length)
        debouncedSaveRef.current(text)
      }
    })

    const cmdSave = keymap.of([
      {
        key: 'Mod-s',
        run: (view) => {
          void saveMemoRef.current(view.state.doc.toString())
          return true
        },
      },
    ])

    const state = EditorState.create({
      doc: contentRef.current,
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
  }, [loaded, viewMode])

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

  const showEditor = viewMode === 'edit' || viewMode === 'split'
  const showPreview = viewMode === 'preview' || viewMode === 'split'

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[20px] font-bold tracking-tight">Memo</h1>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => setViewMode(mode.key)}
                title={mode.label}
                className={`px-2.5 py-1.5 text-[12px] flex items-center gap-1.5 transition-colors ${
                  viewMode === mode.key
                    ? 'bg-[var(--color-accent-glow)] text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                <mode.icon size={14} />
                {mode.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => saveMemo()}
            disabled={saving || saveStatus === 'saved'}
            className="px-3 py-1.5 rounded-lg text-[12px] bg-[var(--color-accent)] text-[var(--color-deep-bg)] hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="card animate-fade-up overflow-hidden">
        {!loaded ? (
          <div className="p-5">
            <Skeleton className="h-4 w-48 mb-3" />
            <SkeletonText lines={8} />
          </div>
        ) : (
          <div className={`${viewMode === 'split' ? 'grid grid-cols-2' : ''}`}>
            {/* Editor panel */}
            {showEditor && (
              <div
                ref={editorRef}
                className={`min-h-[400px] [&_.cm-editor]:outline-none ${
                  viewMode === 'split' ? 'border-r border-[var(--color-border)]' : ''
                }`}
              />
            )}

            {/* Preview panel */}
            {showPreview && (
              <div className="min-h-[400px] p-5 overflow-auto">
                <div
                  className="prose prose-invert prose-sm max-w-none
                  [&_h1]:text-[var(--color-text-primary)] [&_h1]:text-[18px] [&_h1]:font-bold [&_h1]:border-b [&_h1]:border-[var(--color-border)] [&_h1]:pb-2 [&_h1]:mb-3
                  [&_h2]:text-[var(--color-text-primary)] [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2
                  [&_h3]:text-[var(--color-text-secondary)] [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5
                  [&_p]:text-[13px] [&_p]:text-[var(--color-text-secondary)] [&_p]:leading-relaxed [&_p]:mb-2
                  [&_ul]:text-[13px] [&_ul]:text-[var(--color-text-secondary)] [&_ul]:pl-5
                  [&_ol]:text-[13px] [&_ol]:text-[var(--color-text-secondary)] [&_ol]:pl-5
                  [&_li]:mb-0.5
                  [&_code]:text-[12px] [&_code]:font-mono [&_code]:text-[var(--color-accent)] [&_code]:bg-white/[0.04] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
                  [&_pre]:bg-white/[0.03] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-[var(--color-border)]
                  [&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_pre_code]:py-0
                  [&_a]:text-[var(--color-accent)] [&_a]:no-underline hover:[&_a]:underline
                  [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-accent-dim)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--color-text-muted)] [&_blockquote]:italic
                  [&_table]:text-[12px] [&_table]:w-full
                  [&_th]:text-left [&_th]:py-1.5 [&_th]:px-2 [&_th]:border-b [&_th]:border-[var(--color-border)] [&_th]:text-[var(--color-text-muted)] [&_th]:font-semibold
                  [&_td]:py-1.5 [&_td]:px-2 [&_td]:border-b [&_td]:border-[var(--color-border)] [&_td]:text-[var(--color-text-secondary)]
                  [&_hr]:border-[var(--color-border)] [&_hr]:my-4
                  [&_strong]:text-[var(--color-text-primary)] [&_strong]:font-semibold
                "
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content || '*No content yet...*'}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status bar */}
        {loaded && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-disabled)]">
            <span>{wordCount} words</span>
            <div className="flex items-center gap-3">
              <span
                className={
                  saveStatus === 'saved'
                    ? 'text-emerald-400'
                    : saveStatus === 'saving'
                      ? 'text-amber-400'
                      : 'text-[var(--color-text-muted)]'
                }
              >
                {saveStatus === 'saved'
                  ? 'Saved'
                  : saveStatus === 'saving'
                    ? 'Saving...'
                    : 'Unsaved'}
              </span>
              {lastSaved && <span>{formatLastSaved()}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
