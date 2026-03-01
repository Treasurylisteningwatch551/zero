import { X, PaperPlaneRight, CircleNotch, ClipboardText } from '@phosphor-icons/react'
import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useUIStore } from '../../stores/ui'
import { apiPost, apiFetch } from '../../lib/api'
import { useWebSocket } from '../../hooks/useWebSocket'

interface ChatMessage {
  role: 'user' | 'assistant' | 'notification'
  content: string
  title?: string
  severity?: string
}

export function ChatDrawer() {
  const { chatDrawerOpen, toggleChatDrawer } = useUIStore()
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [modelName, setModelName] = useState('unknown')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Fetch current model name
  useEffect(() => {
    if (chatDrawerOpen) {
      apiFetch<{ currentModel: string }>('/api/status')
        .then((res) => setModelName(res.currentModel))
        .catch(() => {})
    }
  }, [chatDrawerOpen])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const maxHeight = 4 * 24 // 4 lines × ~24px line height
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [message])

  // WebSocket: receive notification cards in chat
  const onEvent = useCallback((topic: string, data: unknown) => {
    if (topic === 'notification') {
      const payload = data as Record<string, unknown>
      const n = payload.notification as { title?: string; description?: string; severity?: string } | undefined
      if (n) {
        setMessages((prev) => [...prev, {
          role: 'notification' as const,
          content: n.description ?? '',
          title: n.title,
          severity: n.severity,
        }])
      }
    }
  }, [])

  useWebSocket({
    url: `ws://${window.location.host}/ws`,
    topics: ['notification'],
    onEvent,
  })

  if (!chatDrawerOpen) return null

  async function sendMessage() {
    const text = message.trim()
    if (!text || loading) return

    setMessage('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const res = await apiPost<{ sessionId: string; reply: string }>('/api/chat', {
        message: text,
        sessionId,
      })
      setSessionId(res.sessionId)
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }])
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${errMsg}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed right-0 top-0 h-full w-[360px] bg-[var(--color-main-bg)] border-l border-[var(--color-border)] z-50 flex flex-col"
      style={{ animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">Chat</span>
          <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
            Web Channel · {modelName}
          </span>
        </div>
        <button
          onClick={toggleChatDrawer}
          className="p-1 rounded-md hover:bg-white/[0.05] text-[var(--color-text-muted)]"
        >
          <X size={18} />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="text-center text-[var(--color-text-muted)] text-[13px] py-12">
            Send a message to interact with ZeRo OS
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'notification') {
            return (
              <div
                key={i}
                className="rounded-lg border border-[var(--color-border)] p-3 bg-white/[0.02]"
              >
                <div className="flex items-center gap-2 mb-1">
                  <ClipboardText size={14} className="text-amber-400" />
                  <span className="text-[12px] font-medium text-amber-400">
                    {msg.title ?? 'Notification'}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  {msg.content}
                </p>
              </div>
            )
          }

          return (
            <div
              key={i}
              className={`text-[13px] ${
                msg.role === 'user'
                  ? 'ml-8 border-l-2 border-cyan-400 pl-3 py-2 text-[var(--color-text-primary)]'
                  : 'mr-4 text-[var(--color-text-secondary)]'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
            </div>
          )
        })}

        {loading && (
          <div className="flex items-center gap-2 text-[var(--color-text-muted)] text-[13px]">
            <CircleNotch size={16} className="animate-spin" />
            <span>Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input — multi-line textarea */}
      <div className="p-3 border-t border-[var(--color-border)]">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Send a message..."
            className="input-field flex-1 resize-none min-h-[38px] py-2"
            rows={1}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && message.trim() && !loading) {
                e.preventDefault()
                sendMessage()
              }
            }}
          />
          <button
            className="p-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-deep-bg)] hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40 shrink-0"
            disabled={!message.trim() || loading}
            onClick={sendMessage}
          >
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
