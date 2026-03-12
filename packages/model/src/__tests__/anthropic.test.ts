import { describe, test, expect } from 'bun:test'
import { AnthropicAdapter } from '../adapters/anthropic'
import type { Message, CompletionRequest } from '@zero-os/shared'
import { generateId, now } from '@zero-os/shared'

/**
 * Anthropic adapter tests.
 * Real API tests are skipped when ANTHROPIC_API_KEY is not set or invalid.
 * Pure logic tests (convertMessages, convertTools, mapStopReason) always run.
 */

const ANTHROPIC_TOKEN = process.env.ANTHROPIC_API_KEY ?? ''
const HAS_KEY = ANTHROPIC_TOKEN.length > 0

function createAdapter(): AnthropicAdapter {
  return new AnthropicAdapter({
    baseUrl: 'https://api.anthropic.com',
    auth: { type: 'api_key', apiKeyRef: 'anthropic' },
    modelConfig: {
      modelId: 'claude-sonnet-4-20250514',
      maxContext: 200000,
      maxOutput: 8192,
      capabilities: ['tools', 'vision'],
      tags: ['balanced'],
    },
    apiKey: ANTHROPIC_TOKEN || 'dummy',
  })
}

const adapter = createAdapter()

function makeMessage(role: 'user' | 'assistant', text: string): Message {
  return {
    id: generateId(),
    sessionId: 'test',
    role,
    messageType: 'message',
    content: [{ type: 'text', text }],
    createdAt: now(),
  }
}

describe('Anthropic Adapter (Pure Logic)', () => {
  test('convertMessages correctly handles text messages', () => {
    const messages: Message[] = [
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi there'),
    ]

    const converted = (adapter as any).convertMessages({ messages } as CompletionRequest)
    expect(converted).toHaveLength(2)
    expect(converted[0].role).toBe('user')
    expect(converted[0].content[0].type).toBe('text')
    expect(converted[0].content[0].text).toBe('Hello')
    expect(converted[1].role).toBe('assistant')
    expect(converted[1].content[0].text).toBe('Hi there')
  })

  test('convertMessages correctly handles tool_result blocks', () => {
    const toolCallId = `toolu_${generateId()}`
    const messages: Message[] = [
      makeMessage('user', 'What is 2 + 2?'),
      {
        id: generateId(),
        sessionId: 'test',
        role: 'assistant',
        messageType: 'message',
        content: [
          {
            type: 'tool_use',
            id: toolCallId,
            name: 'calculator',
            input: { expression: '2 + 2' },
          },
        ],
        createdAt: now(),
      },
      {
        id: generateId(),
        sessionId: 'test',
        role: 'user',
        messageType: 'message',
        content: [
          {
            type: 'tool_result',
            toolUseId: toolCallId,
            content: '4',
          },
        ],
        createdAt: now(),
      },
    ]

    const converted = (adapter as any).convertMessages({ messages } as CompletionRequest)

    // Should be: user, assistant (with tool_use), user (with tool_result)
    const roles = converted.map((m: any) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user'])

    // Verify assistant message has tool_use block
    const assistantMsg = converted.find((m: any) => m.role === 'assistant')
    expect(assistantMsg.content[0].type).toBe('tool_use')
    expect(assistantMsg.content[0].id).toBe(toolCallId)
    expect(assistantMsg.content[0].name).toBe('calculator')

    // Verify the tool_result user message
    const toolResultMsg = converted[2]
    expect(toolResultMsg.content[0].type).toBe('tool_result')
    expect(toolResultMsg.content[0].tool_use_id).toBe(toolCallId)
    expect(toolResultMsg.content[0].content).toBe('4')
  })

  test('convertTools maps to Anthropic format', () => {
    const tools = [
      {
        name: 'calculator',
        description: 'Calculate math',
        parameters: { type: 'object', properties: { expr: { type: 'string' } } },
      },
    ]
    const converted = (adapter as any).convertTools(tools)
    expect(converted).toHaveLength(1)
    expect(converted[0].name).toBe('calculator')
    expect(converted[0].description).toBe('Calculate math')
    expect(converted[0].input_schema).toEqual(tools[0].parameters)
  })

  test('convertTools returns undefined for empty array', () => {
    expect((adapter as any).convertTools([])).toBeUndefined()
    expect((adapter as any).convertTools(undefined)).toBeUndefined()
  })

  test('mapStopReason maps Anthropic stop reasons correctly', () => {
    expect((adapter as any).mapStopReason('end_turn')).toBe('end_turn')
    expect((adapter as any).mapStopReason('tool_use')).toBe('tool_use')
    expect((adapter as any).mapStopReason('max_tokens')).toBe('max_tokens')
    expect((adapter as any).mapStopReason(null)).toBe('end_turn')
    expect((adapter as any).mapStopReason('unknown')).toBe('end_turn')
  })

  test('parseContent handles text blocks', () => {
    const content = [{ type: 'text', text: 'Hello world' }]
    const parsed = (adapter as any).parseContent(content)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].type).toBe('text')
    expect(parsed[0].text).toBe('Hello world')
  })

  test('parseContent handles tool_use blocks', () => {
    const content = [
      { type: 'tool_use', id: 'toolu_123', name: 'calc', input: { expr: '1+1' } },
    ]
    const parsed = (adapter as any).parseContent(content)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].type).toBe('tool_use')
    expect(parsed[0].id).toBe('toolu_123')
    expect(parsed[0].name).toBe('calc')
    expect(parsed[0].input).toEqual({ expr: '1+1' })
  })

  test('parseContent ignores thinking blocks in assistant-visible content', () => {
    const content = [
      { type: 'thinking', thinking: 'private chain', signature: 'sig_1' },
      { type: 'text', text: 'Visible answer' },
    ]

    const parsed = (adapter as any).parseContent(content)

    expect(parsed).toEqual([{ type: 'text', text: 'Visible answer' }])
  })

  test('extractReasoningContent reads thinking blocks only', () => {
    const reasoning = (adapter as any).extractReasoningContent([
      { type: 'thinking', thinking: 'step one', signature: 'sig_1' },
      { type: 'redacted_thinking' },
      { type: 'thinking', thinking: 'step two', signature: 'sig_2' },
    ])

    expect(reasoning).toBe('step one\nstep two')
  })

  test('apiType is anthropic_messages', () => {
    expect(adapter.apiType).toBe('anthropic_messages')
  })

  test('stream uses raw SSE create and maps tool events correctly', async () => {
    const streamAdapter = createAdapter()
    const calls: Array<Record<string, unknown>> = []
    let helperCalled = false

    ;(streamAdapter as any).client = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params)
          return (async function* () {
            yield {
              type: 'message_start',
              message: {
                model: 'claude-sonnet-4-20250514',
                usage: { input_tokens: 11, output_tokens: 0 },
              },
            }
            yield {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            }
            yield {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'hello' },
            }
            yield {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'thinking_delta', thinking: 'internal-summary' },
            }
            yield {
              type: 'content_block_stop',
              index: 0,
            }
            yield {
              type: 'content_block_start',
              index: 2,
              content_block: { type: 'redacted_thinking' },
            }
            yield {
              type: 'content_block_stop',
              index: 2,
            }
            yield {
              type: 'content_block_start',
              index: 1,
              content_block: { type: 'tool_use', id: 'toolu_123', name: 'calculator', input: {} },
            }
            yield {
              type: 'content_block_delta',
              index: 1,
              delta: { type: 'input_json_delta', partial_json: '{"expr":"1+1"}' },
            }
            yield {
              type: 'content_block_stop',
              index: 1,
            }
            yield {
              type: 'message_delta',
              delta: { stop_reason: 'tool_use' },
              usage: { output_tokens: 7 },
            }
            yield {
              type: 'message_stop',
            }
          })()
        },
        stream: () => {
          helperCalled = true
          throw new Error('messages.stream should not be used')
        },
      },
    }

    const events: Array<{ type: string; data: unknown }> = []
    for await (const event of streamAdapter.stream({
      messages: [makeMessage('user', 'test')],
      stream: true,
      maxTokens: 123,
    })) {
      events.push(event)
    }

    expect(helperCalled).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0].stream).toBe(true)
    expect(calls[0].max_tokens).toBe(123)
    expect(calls[0].thinking).toBeUndefined()
    expect(events).toEqual([
      { type: 'text_delta', data: { text: 'hello' } },
      { type: 'reasoning_delta', data: { text: 'internal-summary' } },
      { type: 'tool_use_start', data: { id: 'toolu_123', name: 'calculator' } },
      { type: 'tool_use_delta', data: { arguments: '{"expr":"1+1"}' } },
      { type: 'tool_use_end', data: { id: 'toolu_123' } },
      {
        type: 'done',
        data: {
          model: 'claude-sonnet-4-20250514',
          usage: { input: 11, output: 7, cacheWrite: undefined, cacheRead: undefined },
          finishReason: 'tool_use',
        },
      },
    ])
  })

  test('complete enables thinking with a clamped default budget when max_tokens allows it', async () => {
    const thinkingAdapter = new AnthropicAdapter({
      baseUrl: 'https://api.anthropic.com',
      auth: { type: 'api_key', apiKeyRef: 'anthropic' },
      modelConfig: {
        modelId: 'claude-sonnet-4-20250514',
        maxContext: 200000,
        maxOutput: 8192,
        capabilities: ['tools', 'vision'],
        tags: ['balanced'],
      },
      apiKey: 'dummy',
    })

    const calls: Array<Record<string, unknown>> = []
    ;(thinkingAdapter as any).client = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params)
          return {
            id: 'msg_123',
            content: [
              { type: 'thinking', thinking: 'internal summary', signature: 'sig_1' },
              { type: 'text', text: 'final answer' },
            ],
            stop_reason: 'end_turn',
            usage: { input_tokens: 11, output_tokens: 7 },
            model: 'claude-sonnet-4-20250514',
          }
        },
      },
    }

    const result = await thinkingAdapter.complete({
      messages: [makeMessage('user', 'test')],
      stream: false,
      maxTokens: 2048,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].thinking).toEqual({ type: 'enabled', budget_tokens: 1024 })
    expect(result.reasoningContent).toBe('internal summary')
  })

  test('complete honors configured thinkingTokens above the minimum', async () => {
    const thinkingAdapter = new AnthropicAdapter({
      baseUrl: 'https://api.anthropic.com',
      auth: { type: 'api_key', apiKeyRef: 'anthropic' },
      modelConfig: {
        modelId: 'claude-sonnet-4-20250514',
        maxContext: 200000,
        maxOutput: 8192,
        thinkingTokens: 2048,
        capabilities: ['tools', 'vision'],
        tags: ['balanced'],
      },
      apiKey: 'dummy',
    })

    const calls: Array<Record<string, unknown>> = []
    ;(thinkingAdapter as any).client = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          calls.push(params)
          return {
            id: 'msg_124',
            content: [{ type: 'text', text: 'answer' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 11, output_tokens: 7 },
            model: 'claude-sonnet-4-20250514',
          }
        },
      },
    }

    await thinkingAdapter.complete({
      messages: [makeMessage('user', 'test')],
      stream: false,
      maxTokens: 4096,
    })

    expect(calls[0].thinking).toEqual({ type: 'enabled', budget_tokens: 2048 })
  })
})

// Real API tests — only run when ANTHROPIC_API_KEY env var is set
describe.skipIf(!HAS_KEY)('Anthropic Adapter (Real API)', () => {
  test('complete returns a valid response', async () => {
    const response = await adapter.complete({
      messages: [makeMessage('user', 'Say "hello world" and nothing else.')],
      stream: false,
      maxTokens: 50,
    })

    expect(response.id).toBeDefined()
    expect(response.content.length).toBeGreaterThan(0)
    expect(response.content[0].type).toBe('text')
    expect(response.stopReason).toBeDefined()
    expect(response.usage.input).toBeGreaterThan(0)
    expect(response.usage.output).toBeGreaterThan(0)
  }, 30000)

  test('healthCheck returns true for valid endpoint', async () => {
    const healthy = await adapter.healthCheck()
    expect(healthy).toBe(true)
  }, 30000)
})
