import { Robot } from '@phosphor-icons/react'

interface Props {
  text: string
  model?: string
}

export function AgentMessageBlock({ text, model }: Props) {
  return (
    <div className="px-4 py-3">
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
