import { describe, expect, it } from 'bun:test'
import type { ContentBlock, Message, MessageRole, ToolUseBlock } from '../types'
import { collectAssistantReply, extractAssistantText } from '../utils/message'

function makeToolUseBlock(overrides: Partial<ToolUseBlock> = {}): ToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tool-1',
    name: 'search',
    input: {},
    ...overrides,
  }
}

function makeMessage({
  id = 'message-1',
  sessionId = 'session-1',
  role = 'assistant',
  messageType = 'message',
  content = [],
  model,
  createdAt = '2026-03-22T00:00:00.000Z',
}: Partial<Message> & { role?: MessageRole; content?: ContentBlock[] } = {}): Message {
  return {
    id,
    sessionId,
    role,
    messageType,
    content,
    model,
    createdAt,
  }
}

describe('extractAssistantText', () => {
  it('returns the text from a single text block', () => {
    expect(extractAssistantText([{ type: 'text', text: 'Hello world' }])).toBe('Hello world')
  })

  it('concatenates multiple text blocks without a separator', () => {
    expect(
      extractAssistantText([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'world' },
      ]),
    ).toBe('Hello, world')
  })

  it('only extracts text from mixed text and tool_use blocks', () => {
    expect(
      extractAssistantText([
        { type: 'text', text: 'Before' },
        makeToolUseBlock(),
        { type: 'text', text: 'After' },
      ]),
    ).toBe('BeforeAfter')
  })

  it('returns an empty string for an empty array', () => {
    expect(extractAssistantText([])).toBe('')
  })

  it('returns an empty string when all blocks are tool_use blocks', () => {
    expect(
      extractAssistantText([
        makeToolUseBlock({ id: 'tool-1' }),
        makeToolUseBlock({ id: 'tool-2', name: 'lookup' }),
      ]),
    ).toBe('')
  })
})

describe('collectAssistantReply', () => {
  it('returns text from a single assistant message', () => {
    const messages = [
      makeMessage({
        content: [{ type: 'text', text: 'Single reply' }],
      }),
    ]

    expect(collectAssistantReply(messages)).toBe('Single reply')
  })

  it('joins multiple assistant messages with newlines and trims the result', () => {
    const messages = [
      makeMessage({
        id: 'message-1',
        content: [{ type: 'text', text: ' First reply ' }],
      }),
      makeMessage({
        id: 'message-2',
        content: [{ type: 'text', text: 'Second reply ' }],
      }),
      makeMessage({
        id: 'message-3',
        content: [{ type: 'text', text: ' Third reply' }],
      }),
    ]

    expect(collectAssistantReply(messages)).toBe('First reply \nSecond reply \n Third reply')
  })

  it('only extracts assistant text from mixed user and assistant messages', () => {
    const messages = [
      makeMessage({
        id: 'message-1',
        role: 'user',
        content: [{ type: 'text', text: 'User prompt' }],
      }),
      makeMessage({
        id: 'message-2',
        role: 'assistant',
        content: [{ type: 'text', text: 'Assistant reply' }],
      }),
      makeMessage({
        id: 'message-3',
        role: 'system',
        content: [{ type: 'text', text: 'System notice' }],
      }),
    ]

    expect(collectAssistantReply(messages)).toBe('Assistant reply')
  })

  it('returns an empty string for an empty message array', () => {
    expect(collectAssistantReply([])).toBe('')
  })

  it('only extracts text from assistant messages with mixed text and tool_use blocks', () => {
    const messages = [
      makeMessage({
        content: [
          { type: 'text', text: 'Before tool' },
          makeToolUseBlock(),
          { type: 'text', text: 'After tool' },
        ],
      }),
    ]

    expect(collectAssistantReply(messages)).toBe('Before tool\nAfter tool')
  })

  it('returns an empty string when all messages are from users', () => {
    const messages = [
      makeMessage({
        id: 'message-1',
        role: 'user',
        content: [{ type: 'text', text: 'User one' }],
      }),
      makeMessage({
        id: 'message-2',
        role: 'user',
        content: [{ type: 'text', text: 'User two' }],
      }),
    ]

    expect(collectAssistantReply(messages)).toBe('')
  })
})
