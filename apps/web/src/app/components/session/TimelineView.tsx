import { useMemo } from 'react'
import { UserMessageBlock } from './UserMessageBlock'
import { AgentMessageBlock } from './AgentMessageBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { Warning, ArrowsClockwise } from '@phosphor-icons/react'

interface ContentBlock {
  type: string
  [key: string]: unknown
}

interface Message {
  id: string
  role: string
  messageType: string
  content: ContentBlock[]
  model?: string
  createdAt: string
}

export type TimelineItem =
  | { type: 'user-message'; text: string; images?: Array<{ mediaType: string; data: string }>; createdAt: string }
  | { type: 'agent-text'; text: string; model?: string; createdAt: string }
  | { type: 'tool-call'; id: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean; createdAt: string }
  | { type: 'system-event'; variant: 'warning' | 'info'; text: string; createdAt: string }

interface Props {
  messages: Message[]
  selectedToolId: string | null
  onSelectTool: (id: string | null) => void
}

export function TimelineView({ messages, selectedToolId, onSelectTool }: Props) {
  const items = useMemo(() => buildTimeline(messages), [messages])

  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        switch (item.type) {
          case 'user-message':
            return <UserMessageBlock key={i} text={item.text} images={item.images} createdAt={item.createdAt} />
          case 'agent-text':
            return <AgentMessageBlock key={i} text={item.text} model={item.model} />
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

export function buildTimeline(messages: Message[]): TimelineItem[] {
  const items: TimelineItem[] = []
  // Collect tool results by toolUseId
  const toolResults = new Map<string, { content: string; isError: boolean }>()

  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'system') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          toolResults.set(
            block.toolUseId as string,
            { content: block.content as string, isError: !!(block.isError) }
          )
        }
      }
    }
  }

  for (const msg of messages) {
    // System event / notification
    if (msg.messageType === 'notification') {
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text as string)
        .join('\n')
      if (text) {
        const isWarning = text.toLowerCase().includes('timeout') ||
          text.toLowerCase().includes('error') ||
          text.toLowerCase().includes('degrad')
        items.push({
          type: 'system-event',
          variant: isWarning ? 'warning' : 'info',
          text,
          createdAt: msg.createdAt,
        })
      }
      continue
    }

    // User messages
    if (msg.role === 'user') {
      const textBlocks = msg.content.filter((b) => b.type === 'text')
      const imageBlocks = msg.content
        .filter((b) => b.type === 'image')
        .map((b) => ({
          mediaType: b.mediaType as string,
          data: b.data as string,
        }))

      if (textBlocks.length > 0 || imageBlocks.length > 0) {
        const text = textBlocks.map((b) => b.text as string).join('\n')
        items.push({
          type: 'user-message',
          text,
          images: imageBlocks.length > 0 ? imageBlocks : undefined,
          createdAt: msg.createdAt,
        })
      }
      // tool_result blocks are already collected above
      continue
    }

    // Assistant messages
    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'text') {
          items.push({ type: 'agent-text', text: block.text as string, model: msg.model, createdAt: msg.createdAt })
        } else if (block.type === 'tool_use') {
          const result = toolResults.get(block.id as string)
          items.push({
            type: 'tool-call',
            id: block.id as string,
            name: block.name as string,
            input: (block.input as Record<string, unknown>) ?? {},
            result: result?.content,
            isError: result?.isError,
            createdAt: msg.createdAt,
          })
        }
      }
    }
  }

  return items
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

/** Extract all file paths touched by tool calls */
export function extractFilesTouched(items: TimelineItem[]): string[] {
  const files = new Set<string>()
  for (const item of items) {
    if (item.type === 'tool-call') {
      const input = item.input
      if (input.file_path && typeof input.file_path === 'string') {
        files.add(input.file_path)
      }
    }
  }
  return Array.from(files)
}
