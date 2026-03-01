import { X, PaperPlaneRight, CircleNotch } from '@phosphor-icons/react'
import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useUIStore } from '../../stores/ui'
import { apiPost } from '../../lib/api'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export function ChatDrawer() {
  const { chatDrawerOpen, toggleChatDrawer } = useUIStore()
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
        onClick={toggleChatDrawer}
      />

      {/* Drawer panel */}
      <div
        className="fixed right-0 top-0 h-full w-[360px] bg-[var(--color-main-bg)] border-l border-[var(--color-border)] z-50 flex flex-col"
        style={{ animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <span className="text-[14px] font-semibold">Chat</span>
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

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`text-[13px] ${
                msg.role === 'user'
                  ? 'ml-8 bg-[var(--color-accent-glow)] text-[var(--color-text-primary)] rounded-lg px-3 py-2'
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
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-[var(--color-text-muted)] text-[13px]">
              <CircleNotch size={16} className="animate-spin" />
              <span>Thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Send a message..."
              className="input-field flex-1"
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && message.trim() && !loading) {
                  sendMessage()
                }
              }}
            />
            <button
              className="p-2 rounded-lg bg-[var(--color-accent)] text-[var(--color-deep-bg)] hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
              disabled={!message.trim() || loading}
              onClick={sendMessage}
            >
              <PaperPlaneRight size={18} weight="fill" />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  )
}
