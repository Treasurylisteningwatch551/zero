import { Robot } from '@phosphor-icons/react'

interface Props {
  messageId?: string
  text: string
  model?: string
  highlighted?: boolean
}

export function AgentMessageBlock({ messageId, text, model, highlighted = false }: Props) {
  return (
    <div
      data-assistant-message-id={messageId}
      className={`px-4 py-3 rounded-lg transition-all ${highlighted ? 'bg-cyan-400/10 ring-1 ring-cyan-400/40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <Robot size={16} weight="bold" className="text-[var(--color-accent)] mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          {model && (
            <span className="text-[10px] text-[var(--color-text-disabled)] font-mono">{model}</span>
          )}
          <p className="text-[13px] text-slate-200 whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    </div>
  )
}
