import { User } from '@phosphor-icons/react'

interface Props {
  text: string
  createdAt: string
}

export function UserMessageBlock({ text }: Props) {
  return (
    <div
      className="px-4 py-3 rounded-lg"
      style={{
        background: 'rgba(34, 211, 238, 0.06)',
        borderLeft: '2px solid rgb(34, 211, 238)',
      }}
    >
      <div className="flex items-start gap-2">
        <User size={16} weight="bold" className="text-cyan-400 mt-0.5 shrink-0" />
        <p className="text-[13px] text-[var(--color-text-primary)] whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  )
}
