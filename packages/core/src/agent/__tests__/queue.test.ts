import { describe, test, expect } from 'bun:test'
import { formatQueuedMessages, injectQueuedMessages, isTaskComplete, CONTINUATION_PROMPT, type QueuedMessage } from '../queue'
import type { Message, ContentBlock } from '@zero-os/shared'
import { generateId, now } from '@zero-os/shared'

function makeUserMessage(content: ContentBlock[]): Message {
  return { id: generateId(), sessionId: 'test', role: 'user', messageType: 'message', content, createdAt: now() }
}

describe('formatQueuedMessages', () => {
  test('returns empty string for empty array', () => {
    expect(formatQueuedMessages([])).toBe('')
  })

  test('single message wraps in <queued_message> tag', () => {
    const msgs: QueuedMessage[] = [{ content: 'hello', timestamp: '2026-03-03T10:30:00Z' }]
    const result = formatQueuedMessages(msgs)
    expect(result).toContain('<queued_message>')
    expect(result).toContain('</queued_message>')
    expect(result).toContain('hello')
  })

  test('single message prevents asking for continue', () => {
    const msgs: QueuedMessage[] = [{ content: 'ping', timestamp: '2026-03-03T10:30:00Z' }]
    const result = formatQueuedMessages(msgs)
    expect(result).toContain('不要因为这条消息向用户请求“继续”')
    expect(result).toContain('状态查询')
  })

  test('multiple messages wraps in <queued_messages count="N">', () => {
    const msgs: QueuedMessage[] = [
      { content: 'msg1', timestamp: '2026-03-03T10:30:00Z' },
      { content: 'msg2', timestamp: '2026-03-03T10:31:00Z' },
    ]
    const result = formatQueuedMessages(msgs)
    expect(result).toContain('<queued_messages count="2">')
    expect(result).toContain('</queued_messages>')
  })

  test('multiple messages includes timestamps [HH:MM]', () => {
    const msgs: QueuedMessage[] = [
      { content: 'msg1', timestamp: '2026-03-03T10:30:00Z' },
      { content: 'msg2', timestamp: '2026-03-03T14:05:00Z' },
    ]
    const result = formatQueuedMessages(msgs)
    expect(result).toContain('[10:30]')
    expect(result).toContain('[14:05]')
  })

  test('over 5 messages shows omission note', () => {
    const msgs: QueuedMessage[] = Array.from({ length: 8 }, (_, i) => ({
      content: `msg${i}`,
      timestamp: `2026-03-03T10:${String(i).padStart(2, '0')}:00Z`,
    }))
    const result = formatQueuedMessages(msgs)
    expect(result).toContain('[还有 3 条早期消息已省略]')
    expect(result).toContain('count="8"')
  })
})

describe('injectQueuedMessages', () => {
  test('appends text block to existing content', () => {
    const original = makeUserMessage([{ type: 'text', text: 'original' }])
    const queued: QueuedMessage[] = [{ content: 'queued msg', timestamp: '2026-03-03T10:30:00Z' }]
    const result = injectQueuedMessages(original, queued)
    expect(result.content).toHaveLength(2)
    expect(result.content[0]).toEqual({ type: 'text', text: 'original' })
    expect(result.content[1]).toHaveProperty('type', 'text')
    expect((result.content[1] as { type: 'text'; text: string }).text).toContain('queued msg')
  })

  test('does not mutate original message', () => {
    const original = makeUserMessage([{ type: 'text', text: 'original' }])
    const contentRef = original.content
    const queued: QueuedMessage[] = [{ content: 'queued', timestamp: '2026-03-03T10:30:00Z' }]
    injectQueuedMessages(original, queued)
    expect(original.content).toBe(contentRef)
    expect(original.content).toHaveLength(1)
  })

  test('returns original when queued is empty', () => {
    const original = makeUserMessage([{ type: 'text', text: 'hi' }])
    const result = injectQueuedMessages(original, [])
    expect(result).toBe(original)
  })
})

describe('isTaskComplete', () => {
  test('returns true when text contains "已完成"', () => {
    const content: ContentBlock[] = [{ type: 'text', text: '任务已完成，文件已保存。' }]
    expect(isTaskComplete(content)).toBe(true)
  })

  test('returns false when content has tool_use block', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: '已完成' },
      { type: 'tool_use', id: 'tu_1', name: 'read', input: { path: '/tmp' } },
    ]
    expect(isTaskComplete(content)).toBe(false)
  })
})

describe('CONTINUATION_PROMPT', () => {
  test('contains <system_notice> tag', () => {
    expect(CONTINUATION_PROMPT).toContain('<system_notice>')
    expect(CONTINUATION_PROMPT).toContain('</system_notice>')
    expect(CONTINUATION_PROMPT).toContain('不要向用户请求“继续”')
  })
})
