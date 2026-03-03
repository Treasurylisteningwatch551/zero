import { describe, test, expect } from 'bun:test'
import { OpenAIResponsesAdapter } from '../adapters/openai-resp'
import type { Message, CompletionRequest } from '@zero-os/shared'
import { generateId, now } from '@zero-os/shared'

const adapter = new OpenAIResponsesAdapter({
  baseUrl: 'https://api.example.com',
  auth: { type: 'api_key', apiKeyRef: 'test' },
  modelConfig: {
    modelId: 'test-model',
    maxContext: 128000,
    maxOutput: 8192,
    capabilities: [],
    tags: [],
  },
  apiKey: 'dummy',
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

describe('OpenAI Responses API Adapter (Pure Logic)', () => {
  test('buildInput: system prompt becomes system role message', () => {
    const req: CompletionRequest = {
      messages: [makeMessage('user', 'Hello')],
      system: 'You are a helpful assistant.',
      stream: false,
    }

    const input = (adapter as any).buildInput(req)

    expect(input[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' })
    expect(input[1]).toEqual({ role: 'user', content: 'Hello' })
  })

  test('buildInput: user messages correctly mapped', () => {
    const req: CompletionRequest = {
      messages: [
        makeMessage('user', 'First message'),
        makeMessage('assistant', 'Response'),
        makeMessage('user', 'Second message'),
      ],
      stream: false,
    }

    const input = (adapter as any).buildInput(req)

    expect(input[0]).toEqual({ role: 'user', content: 'First message' })
    expect(input[1]).toEqual({ role: 'assistant', content: 'Response' })
    expect(input[2]).toEqual({ role: 'user', content: 'Second message' })
  })

  test('buildInput: tool_result blocks become function_call_output', () => {
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

    const input = (adapter as any).buildInput({ messages, stream: false } as CompletionRequest)

    // user text, function_call (from assistant), function_call_output (from tool_result)
    expect(input[0]).toEqual({ role: 'user', content: 'What is 2 + 2?' })
    expect(input[1]).toMatchObject({
      type: 'function_call',
      call_id: toolCallId,
      name: 'calculator',
      arguments: JSON.stringify({ expression: '2 + 2' }),
    })
    expect(input[2]).toEqual({
      type: 'function_call_output',
      call_id: toolCallId,
      output: '4',
    })
  })

  test('convertTools: maps to function type with parameters', () => {
    const tools = [
      {
        name: 'search',
        description: 'Search the web.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    ]

    const converted = (adapter as any).convertTools(tools)

    expect(converted).toEqual([
      {
        type: 'function',
        name: 'search',
        description: 'Search the web.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    ])
  })

  test('parseResponse: text output parsed correctly', () => {
    const mockResponse = {
      id: 'resp_123',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Hello world' }] },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'test-model',
      status: 'completed',
    }

    const result = (adapter as any).parseResponse(mockResponse)

    expect(result.id).toBe('resp_123')
    expect(result.content).toEqual([{ type: 'text', text: 'Hello world' }])
    expect(result.stopReason).toBe('end_turn')
    expect(result.model).toBe('test-model')
    expect(result.usage.input).toBe(10)
    expect(result.usage.output).toBe(5)
  })

  test('parseUsage: token counts extracted correctly', () => {
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 10 },
    }

    const result = (adapter as any).parseUsage(usage)

    expect(result.input).toBe(100)
    expect(result.output).toBe(50)
    expect(result.reasoning).toBe(10)
  })
})
