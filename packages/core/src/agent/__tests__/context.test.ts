import { describe, expect, test } from 'bun:test'
import { generateId, now } from '@zero-os/shared'
import type { ContentBlock, Message } from '@zero-os/shared'
import { estimateConversationTokens, prepareConversationHistory } from '../context'

function makeMessage(role: 'user' | 'assistant', content: ContentBlock[]): Message {
  return {
    id: generateId(),
    sessionId: 'test-session',
    role,
    messageType: 'message',
    content,
    createdAt: now(),
  }
}

function makeUserText(text: string): Message {
  return makeMessage('user', [{ type: 'text', text }])
}

function makeToolResult(toolUseId: string, output: string, isError = false): Message {
  return makeMessage('user', [{ type: 'tool_result', toolUseId, content: output, isError }])
}

function makeAssistantText(text: string): Message {
  return makeMessage('assistant', [{ type: 'text', text }])
}

function makeQueuedUserText(text: string): Message {
  return {
    ...makeMessage('user', [{ type: 'text', text }]),
    messageType: 'queued',
  }
}

function makeAssistantToolUse(name: string, toolUseId: string): Message {
  return makeMessage('assistant', [
    { type: 'text', text: 'Using tool...' },
    { type: 'tool_use', id: toolUseId, name, input: {} },
  ])
}

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined()
  if (value == null) {
    throw new Error('Expected value to be defined')
  }
  return value
}

/**
 * Build a conversation with N turns.
 * Each turn consists of:
 *   1. User text message (turn boundary)
 *   2. Assistant tool_use message
 *   3. User tool_result message
 *   4. Assistant text reply
 */
function buildConversation(turnCount: number): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < turnCount; i++) {
    const toolId = `tool-${i}`
    messages.push(makeUserText(`User question for turn ${i}`))
    messages.push(makeAssistantToolUse('bash', toolId))
    messages.push(
      makeToolResult(toolId, `Full output of tool execution for turn ${i}. `.repeat(20), false),
    )
    messages.push(makeAssistantText(`Response for turn ${i}`))
  }
  return messages
}

describe('prepareConversationHistory', () => {
  test('returns empty array for empty input', () => {
    const result = prepareConversationHistory([])
    expect(result).toEqual([])
  })

  test('does not modify original messages array (immutability)', () => {
    const messages = buildConversation(6)
    const originalContent = messages.map((m) => m.content.map((b) => ({ ...b })))

    prepareConversationHistory(messages)

    // Verify every message's content is unchanged
    for (let i = 0; i < messages.length; i++) {
      expect(messages[i].content).toEqual(originalContent[i])
    }
  })

  test('preserves full tool output for turns 0-3 (most recent)', () => {
    const messages = buildConversation(4)
    const result = prepareConversationHistory(messages)

    // All 4 turns are within age 0-3, so all tool_results should be preserved
    for (let i = 0; i < result.length; i++) {
      const msg = result[i]
      if (msg.role === 'user') {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            expect(block.content).toBe(
              expectDefined(messages[i].content.find((b) => b.type === 'tool_result')).content,
            )
          }
        }
      }
    }
  })

  test('truncates tool output to ~200 chars for turns 4-8', () => {
    // 12 turns: turns 0-3 = full, 4-8 = truncated, 9-11 = status only
    // Turn numbering is from the end, so the oldest turns get the highest age.
    const messages = buildConversation(12)
    const result = prepareConversationHistory(messages)

    // Turn 5 (age 6 from end) should be truncated.
    // In a 12-turn conversation, turn indices from end:
    //   chronological turn 0 => age 11 (status only)
    //   chronological turn 3 => age 8 (truncated)
    //   chronological turn 7 => age 4 (truncated)
    //   chronological turn 8 => age 3 (full)

    // Check a mid-range turn (chronological turn 5 => age 6)
    // Each turn = 4 messages. Turn 5 tool_result is at index 5*4+2 = 22
    const midToolResult = result[22]
    expect(midToolResult.role).toBe('user')
    const midBlock = expectDefined(midToolResult.content.find((b) => b.type === 'tool_result'))
    // The original content is long (~800 chars), truncated should be ~200 + "..."
    expect(midBlock.content.length).toBeLessThanOrEqual(210)
    expect(midBlock.content).toEndWith('...')
  })

  test('replaces tool output with status for turns 9+', () => {
    const messages = buildConversation(12)
    const result = prepareConversationHistory(messages)

    // Chronological turn 0 has age 11 (status only)
    // Turn 0 tool_result is at index 0*4+2 = 2
    const oldToolResult = result[2]
    expect(oldToolResult.role).toBe('user')
    const oldBlock = expectDefined(oldToolResult.content.find((b) => b.type === 'tool_result'))
    expect(oldBlock.content).toBe('\u2713 success')
  })

  test('handles error tool results with failed prefix', () => {
    const messages: Message[] = []
    // Build 12 turns, but make the first turn (oldest) have an error
    for (let i = 0; i < 12; i++) {
      const toolId = `tool-${i}`
      const isError = i === 0 // First turn has error
      messages.push(makeUserText(`Question ${i}`))
      messages.push(makeAssistantToolUse('bash', toolId))
      messages.push(makeToolResult(toolId, `Error: command not found in turn ${i}`, isError))
      messages.push(makeAssistantText(`Reply ${i}`))
    }

    const result = prepareConversationHistory(messages)

    // Turn 0 (chronological) has age 11 => status only, with error
    const errorResult = result[2]
    const errorBlock = expectDefined(errorResult.content.find((b) => b.type === 'tool_result'))
    expect(errorBlock.content).toContain('\u2717 failed:')
    expect(errorBlock.content).toContain('Error: command not found')
  })

  test('handles success tool results with success marker', () => {
    const messages = buildConversation(12)
    const result = prepareConversationHistory(messages)

    // Chronological turn 1 has age 10 => status only, success
    // Turn 1 tool_result at index 1*4+2 = 6
    const successResult = result[6]
    const successBlock = expectDefined(successResult.content.find((b) => b.type === 'tool_result'))
    expect(successBlock.content).toBe('\u2713 success')
  })

  test('leaves assistant messages untouched', () => {
    const messages = buildConversation(12)
    const result = prepareConversationHistory(messages)

    // Check all assistant messages are identical references
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'assistant') {
        expect(result[i]).toBe(messages[i])
      }
    }
  })

  test('uses outputSummary when available for mid-range truncation', () => {
    const messages: Message[] = []
    // Build 6 turns; turn 0 (chronological, age 5) should be truncated
    for (let i = 0; i < 6; i++) {
      const toolId = `tool-${i}`
      messages.push(makeUserText(`Question ${i}`))
      messages.push(makeAssistantToolUse('bash', toolId))
      if (i === 0) {
        // Give the oldest turn an outputSummary
        messages.push(
          makeMessage('user', [
            {
              type: 'tool_result',
              toolUseId: toolId,
              content: 'A'.repeat(1000),
              outputSummary: 'Custom summary of output',
            },
          ]),
        )
      } else {
        messages.push(makeToolResult(toolId, `Output for turn ${i}`))
      }
      messages.push(makeAssistantText(`Reply ${i}`))
    }

    const result = prepareConversationHistory(messages)

    // Turn 0 (chronological) has age 5 => mid-range truncation
    const block = expectDefined(result[2].content.find((b) => b.type === 'tool_result'))
    expect(block.content).toContain('Custom summary of output')
  })

  test('preserves user text messages that are not tool results', () => {
    const messages = buildConversation(12)
    const result = prepareConversationHistory(messages)

    // Every user text message (every 4th starting from 0) should be preserved
    for (let i = 0; i < 12; i++) {
      const textMsg = result[i * 4]
      expect(textMsg.role).toBe('user')
      const textBlock = expectDefined(textMsg.content.find((b) => b.type === 'text'))
      expect(textBlock.text).toContain(`turn ${i}`)
    }
  })

  test('does not treat queued user messages as turn boundaries', () => {
    const messages: Message[] = [
      makeUserText('turn 1'),
      makeAssistantToolUse('bash', 'tool-1'),
      makeToolResult('tool-1', 'A'.repeat(400)),
      makeAssistantText('reply 1'),
      makeQueuedUserText('late follow-up'),
      makeAssistantText('queued ack'),
      makeUserText('turn 2'),
      makeAssistantToolUse('bash', 'tool-2'),
      makeToolResult('tool-2', 'B'.repeat(400)),
      makeAssistantText('reply 2'),
    ]

    const result = prepareConversationHistory(messages)
    const olderToolResult = expectDefined(
      result[2].content.find((block) => block.type === 'tool_result'),
    )

    expect(olderToolResult.content).toBe('A'.repeat(400))
    expect(result[4]).toBe(messages[4])
  })
})

describe('estimateConversationTokens', () => {
  test('returns 0 for empty messages', () => {
    expect(estimateConversationTokens([])).toBe(0)
  })

  test('returns positive number for non-empty messages', () => {
    const messages = [
      makeUserText('Hello, how are you?'),
      makeAssistantText('I am fine, thank you!'),
    ]
    const tokens = estimateConversationTokens(messages)
    expect(tokens).toBeGreaterThan(0)
  })

  test('includes per-message overhead', () => {
    const single = [makeUserText('Hi')]
    const double = [makeUserText('Hi'), makeAssistantText('Hi')]

    const singleTokens = estimateConversationTokens(single)
    const doubleTokens = estimateConversationTokens(double)

    // The second message adds content tokens + 4 overhead
    expect(doubleTokens).toBeGreaterThan(singleTokens)
    // Overhead difference should be at least 4 (per-message overhead)
    expect(doubleTokens - singleTokens).toBeGreaterThanOrEqual(4)
  })

  test('counts tool_result content tokens', () => {
    const shortResult = [makeToolResult('t1', 'ok')]
    const longResult = [makeToolResult('t1', 'x'.repeat(1000))]

    const shortTokens = estimateConversationTokens(shortResult)
    const longTokens = estimateConversationTokens(longResult)

    expect(longTokens).toBeGreaterThan(shortTokens)
  })
})
