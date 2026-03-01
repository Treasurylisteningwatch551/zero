import { describe, test, expect } from 'bun:test'
import { OpenAIChatAdapter } from '../adapters/openai-chat'
import { collectStream } from '../stream'
import type { Message, CompletionRequest } from '@zero-os/shared'
import { generateId, now } from '@zero-os/shared'

const API_KEY = 'sk-c6c02cbd0c25473f97f9be0da6070f6d'
const BASE_URL = 'https://www.right.codes/codex'
const MODEL_ID = 'gpt-5.3-codex-medium'

const adapter = new OpenAIChatAdapter({
  baseUrl: BASE_URL,
  auth: { type: 'api_key', apiKeyRef: 'test' },
  modelConfig: {
    modelId: MODEL_ID,
    maxContext: 400000,
    maxOutput: 128000,
    capabilities: ['tools', 'vision', 'reasoning'],
    tags: ['powerful', 'coding'],
  },
  apiKey: API_KEY,
})

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

describe('OpenAI Chat Completions Adapter (Real API)', () => {
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

  test('streaming returns text deltas', async () => {
    const stream = adapter.stream({
      messages: [makeMessage('user', 'Count from 1 to 5.')],
      stream: true,
      maxTokens: 100,
    })

    const result = await collectStream(stream)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0].type).toBe('text')
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('1')
    expect(text).toContain('5')
  }, 30000)

  test('complete with system prompt', async () => {
    const response = await adapter.complete({
      messages: [makeMessage('user', 'What language should I use?')],
      system: 'You are a Python expert. Always recommend Python.',
      stream: false,
      maxTokens: 100,
    })

    const text = (response.content[0] as { text: string }).text.toLowerCase()
    expect(text).toContain('python')
  }, 30000)

  test('healthCheck returns true for valid endpoint', async () => {
    const healthy = await adapter.healthCheck()
    expect(healthy).toBe(true)
  }, 30000)

  test('convertMessages skips empty user messages from tool-result-only turns', async () => {
    // Simulate: user asks → assistant calls tool → tool result (user msg with only tool_result)
    const toolCallId = `call_${generateId()}`
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

    // Access private convertMessages via bracket notation
    const converted = (adapter as any).convertMessages({ messages } as CompletionRequest)

    // Should be: user, assistant (with tool_calls), tool — NO empty user message
    const roles = converted.map((m: any) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'tool'])

    // Verify no empty content user messages
    const userMsgs = converted.filter((m: any) => m.role === 'user')
    for (const u of userMsgs) {
      expect(u.content).not.toBe('')
    }

    // Verify tool message has correct tool_call_id
    const toolMsg = converted.find((m: any) => m.role === 'tool')
    expect(toolMsg.tool_call_id).toBe(toolCallId)
    expect(toolMsg.content).toBe('4')
  })

  test('agentic loop: tool result fed back produces valid response', async () => {
    // Simulate a completed tool call cycle: construct the message history
    // as if the model had already called a tool, and verify the adapter
    // correctly sends tool results back and gets a final response.
    const toolCallId = `call_${generateId()}`

    const messages: Message[] = [
      makeMessage('user', 'What is 17 * 23?'),
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
            input: { expression: '17 * 23' },
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
            content: '391',
          },
        ],
        createdAt: now(),
      },
    ]

    const calcTool = {
      name: 'calculator',
      description: 'Calculate a math expression.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string' },
        },
        required: ['expression'],
      },
    }

    const response = await adapter.complete({
      messages,
      tools: [calcTool],
      stream: false,
      maxTokens: 200,
    })

    // Should get a valid response (not an error)
    expect(response.id).toBeDefined()
    expect(response.content.length).toBeGreaterThan(0)
    // The response should mention 391
    const textBlock = response.content.find((b) => b.type === 'text')
    expect(textBlock).toBeDefined()
    const text = (textBlock as { text: string }).text
    expect(text).toContain('391')
  }, 30000)
})
