import { ArrowsClockwise, Warning } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { AgentMessageBlock } from './AgentMessageBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { UserMessageBlock } from './UserMessageBlock'
import {
  type Message,
  type PersistedTaskClosureEvent,
  type TraceSpan,
  buildTimeline,
} from './timeline'

interface Props {
  messages: Message[]
  traces?: TraceSpan[]
  taskClosureEvents?: PersistedTaskClosureEvent[]
  selectedToolId: string | null
  highlightedAssistantMessageId?: string | null
  onSelectTool: (id: string | null) => void
}

export function TimelineView({
  messages,
  traces,
  taskClosureEvents,
  selectedToolId,
  highlightedAssistantMessageId,
  onSelectTool,
}: Props) {
  const items = useMemo(
    () => buildTimeline(messages, traces, taskClosureEvents),
    [messages, traces, taskClosureEvents],
  )

  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        switch (item.type) {
          case 'user-message':
            return (
              <UserMessageBlock
                key={i}
                text={item.text}
                images={item.images}
                createdAt={item.createdAt}
              />
            )
          case 'agent-text':
            return (
              <AgentMessageBlock
                key={`${item.messageId}-${i}`}
                messageId={item.messageId}
                text={item.text}
                model={item.model}
                highlighted={highlightedAssistantMessageId === item.messageId}
              />
            )
          case 'tool-call':
            return (
              <ToolCallBlock
                key={item.id}
                id={item.id}
                name={item.name}
                input={item.input}
                result={item.result}
                isError={item.isError}
                selected={selectedToolId === item.id}
                onSelect={(id) => onSelectTool(selectedToolId === id ? null : id)}
              />
            )
          case 'system-event':
            return <SystemEventBanner key={i} variant={item.variant} text={item.text} />
          default:
            return null
        }
      })}
    </div>
  )
}

function SystemEventBanner({ variant, text }: { variant: 'warning' | 'info'; text: string }) {
  const isWarning = variant === 'warning'
  const Icon = isWarning ? Warning : ArrowsClockwise
  const borderColor = isWarning ? 'border-l-amber-400' : 'border-l-cyan-400'
  const iconColor = isWarning ? 'text-amber-400' : 'text-cyan-400'
  const textColor = isWarning ? 'text-amber-400' : 'text-cyan-400'

  return (
    <div className={`px-4 py-2 rounded-lg border-l-2 ${borderColor} bg-white/[0.02]`}>
      <div className="flex items-center gap-2">
        <Icon size={14} weight="bold" className={iconColor} />
        <span className={`text-[12px] font-mono ${textColor}`}>{text}</span>
      </div>
    </div>
  )
}

export type { TimelineItem, Message, PersistedTaskClosureEvent, TraceSpan } from './timeline'
export { buildTimeline, extractFilesTouched } from './timeline'
