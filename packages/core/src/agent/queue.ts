import type { Message, ContentBlock } from '@zero-os/shared'
import { CONTEXT_PARAMS } from './params'

export interface QueuedMessage {
  content: string
  images?: Array<{ mediaType: string; data: string }>
  timestamp: string
}

/**
 * Format queued messages into XML-wrapped text for injection.
 * Single message: <queued_message> tag
 * Multiple messages: <queued_messages count="N"> tag with timestamps
 * Over maxRetain: earliest messages summarized
 */
export function formatQueuedMessages(messages: QueuedMessage[]): string {
  if (messages.length === 0) return ''

  const maxRetain = CONTEXT_PARAMS.queue.maxRetainMessages

  if (messages.length === 1) {
    return `<queued_message>
以下是你执行任务期间用户发来的消息。请简短回应后继续执行之前的任务，不要中断当前工作流。
---
${messages[0].content}
</queued_message>`
  }

  // Multiple messages
  let retained = messages
  let omittedNote = ''
  if (messages.length > maxRetain) {
    const omitted = messages.length - maxRetain
    omittedNote = `[还有 ${omitted} 条早期消息已省略]\n`
    retained = messages.slice(-maxRetain)
  }

  const formatted = retained
    .map(m => {
      const time = m.timestamp.slice(11, 16) // HH:MM
      return `[${time}] ${m.content}`
    })
    .join('\n')

  return `<queued_messages count="${messages.length}">
以下是你执行任务期间用户发来的 ${messages.length} 条消息。请统一简短回应后继续执行之前的任务。
---
${omittedNote}${formatted}
</queued_messages>`
}

/**
 * Inject formatted queued messages into the last user message as a text block.
 * Returns a new Message (does not mutate the original).
 */
export function injectQueuedMessages(lastUserMsg: Message, queued: QueuedMessage[]): Message {
  if (queued.length === 0) return lastUserMsg

  const formattedText = formatQueuedMessages(queued)
  const newContent: ContentBlock[] = [
    ...lastUserMsg.content,
    { type: 'text', text: formattedText },
  ]

  // Merge images from queued messages
  for (const q of queued) {
    if (q.images?.length) {
      for (const img of q.images) {
        newContent.push({ type: 'image', mediaType: img.mediaType, data: img.data })
      }
    }
  }

  return { ...lastUserMsg, content: newContent }
}

/**
 * Continuation prompt to re-engage the model after it responds to queued messages
 * but the original task is not yet complete.
 */
export const CONTINUATION_PROMPT = `<system_notice>
你刚才回应了用户的插队消息，但之前的任务尚未完成。请继续执行。
当前进度可参考上方的工具调用历史。
</system_notice>`

/**
 * Check if the assistant's response indicates task completion.
 * Returns true if the content has only text blocks (no tool_use)
 * and contains a completion signal word.
 */
export function isTaskComplete(content: ContentBlock[]): boolean {
  const hasToolUse = content.some(b => b.type === 'tool_use')
  if (hasToolUse) return false

  const text = content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')

  const completionSignals = ['已完成', '完成了', '任务结束', '重构完成', '修改完成', '处理完成', 'done', 'completed', 'finished']
  return completionSignals.some(signal => text.includes(signal))
}
