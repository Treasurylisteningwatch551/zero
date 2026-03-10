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

  test('buildInput: empty tool_result output falls back to outputSummary', () => {
    const toolCallId = `call_${generateId()}`
    const messages: Message[] = [
      makeMessage('user', 'Run command'),
      {
        id: generateId(),
        sessionId: 'test',
        role: 'assistant',
        messageType: 'message',
        content: [
          {
            type: 'tool_use',
            id: toolCallId,
            name: 'bash',
            input: { command: 'find . -name AGENTS.md' },
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
            content: '',
            outputSummary: 'Executed: find . -name AGENTS.md',
          },
        ],
        createdAt: now(),
      },
    ]

    const input = (adapter as any).buildInput({ messages, stream: false } as CompletionRequest)

    expect(input[2]).toEqual({
      type: 'function_call_output',
      call_id: toolCallId,
      output: 'Executed: find . -name AGENTS.md',
    })
  })

  test('buildInput: only paired tool_use and tool_result are serialized', () => {
    const pairedId = `call_${generateId()}`
    const danglingToolUseId = `call_${generateId()}`
    const orphanToolResultId = `call_${generateId()}`

    const messages: Message[] = [
      makeMessage('user', 'Start'),
      {
        id: generateId(),
        sessionId: 'test',
        role: 'assistant',
        messageType: 'message',
        content: [
          {
            type: 'tool_use',
            id: pairedId,
            name: 'read',
            input: { path: '/tmp/a.txt' },
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
            toolUseId: pairedId,
            content: 'ok',
          },
        ],
        createdAt: now(),
      },
      {
        id: generateId(),
        sessionId: 'test',
        role: 'assistant',
        messageType: 'message',
        content: [
          {
            type: 'tool_use',
            id: danglingToolUseId,
            name: 'bash',
            input: { command: 'echo hi' },
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
            toolUseId: orphanToolResultId,
            content: 'orphan-result',
          },
        ],
        createdAt: now(),
      },
      makeMessage('user', 'Continue'),
    ]

    const input = (adapter as any).buildInput({ messages, stream: false } as CompletionRequest)
    const functionCalls = input.filter((i: any) => i.type === 'function_call')
    const functionCallOutputs = input.filter((i: any) => i.type === 'function_call_output')

    expect(functionCalls.length).toBe(1)
    expect(functionCalls[0].call_id).toBe(pairedId)

    expect(functionCallOutputs.length).toBe(1)
    expect(functionCallOutputs[0].call_id).toBe(pairedId)
    expect(functionCallOutputs[0].output).toBe('ok')
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



  test('buildChatGptBody falls back to default instructions for ChatGPT', () => {
    const chatgptAdapter = new OpenAIResponsesAdapter({
      providerName: 'chatgpt',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      auth: { type: 'oauth2', oauthTokenRef: 'chatgpt_oauth_token' },
      modelConfig: {
        modelId: 'gpt-5.4',
        maxContext: 128000,
        maxOutput: 8192,
        capabilities: [],
        tags: [],
      },
      oauthToken: JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 180_000,
        tokenType: 'Bearer',
        accountId: 'acct_123',
      }),
    })

    const body = (chatgptAdapter as any).buildChatGptBody({
      messages: [],
      stream: true,
    })

    expect(body.instructions).toBe('You are a helpful assistant.')
  })

  test('buildChatGptBody omits unsupported max_output_tokens', () => {
    const chatgptAdapter = new OpenAIResponsesAdapter({
      providerName: 'chatgpt',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      auth: { type: 'oauth2', oauthTokenRef: 'chatgpt_oauth_token' },
      modelConfig: {
        modelId: 'gpt-5.3-codex-medium',
        maxContext: 128000,
        maxOutput: 8192,
        capabilities: [],
        tags: [],
      },
      oauthToken: JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 180_000,
        tokenType: 'Bearer',
        accountId: 'acct_123',
      }),
    })

    const body = (chatgptAdapter as any).buildChatGptBody({
      messages: [],
      stream: true,
      maxTokens: 123,
    })

    expect(body.max_output_tokens).toBeUndefined()
    expect(body.stream).toBe(true)
    expect(body.model).toBe('gpt-5.3-codex-medium')
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


  test('parseChatGptCompletion preserves composite call_id|fc_id as tool_use id', () => {
    const result = (adapter as any).parseChatGptCompletion([
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          id: 'fc_item_1',
          call_id: 'call_123',
          name: 'read',
          arguments: '{"path":"a.txt"}',
        },
      },
      {
        type: 'response.completed',
        response: { id: 'resp_1', model: 'test-model', status: 'completed', usage: {} },
      },
    ])

    expect(result.content).toContainEqual({
      type: 'tool_use',
      id: 'call_123|fc_item_1',
      name: 'read',
      input: { path: 'a.txt' },
    })
  })

  test('streamFromChatGpt emits call_id on tool deltas', async () => {
    const chatgptAdapter = new OpenAIResponsesAdapter({
      providerName: 'chatgpt',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      auth: { type: 'oauth2', oauthTokenRef: 'chatgpt_oauth_token' },
      modelConfig: {
        modelId: 'gpt-5.4-medium',
        maxContext: 128000,
        maxOutput: 8192,
        capabilities: [],
        tags: [],
      },
      oauthToken: JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 180_000,
        tokenType: 'Bearer',
        accountId: 'acct_123',
      }),
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(
      [
        'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_123","name":"read","arguments":""}}',
        '',
        'data: {"type":"response.function_call_arguments.delta","call_id":"call_123","delta":"chunk-1"}',
        '',
        'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_123"}}',
        '',
        'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.4-medium","status":"completed","usage":{}}}',
        '',
      ].join('\n'),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }
    ) as any

    try {
      const events = [] as Array<{ type: string; data: any }>
      for await (const event of chatgptAdapter.stream({ messages: [], stream: true })) {
        events.push(event as any)
      }

      expect(events).toContainEqual({ type: 'tool_use_start', data: { id: 'call_123', name: 'read' } })
      expect(events).toContainEqual({ type: 'tool_use_delta', data: { id: 'call_123', arguments: 'chunk-1' } })
      expect(events).toContainEqual({ type: 'tool_use_end', data: { id: 'call_123' } })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
