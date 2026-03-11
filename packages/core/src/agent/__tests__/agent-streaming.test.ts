import { describe, test, expect } from 'bun:test'
import { Agent, type AgentContext } from '../agent'
import type { ProviderAdapter } from '@zero-os/model'
import type { CompletionRequest, CompletionResponse, StreamEvent, ToolContext } from '@zero-os/shared'
import { ToolRegistry } from '../../tool/registry'

class StreamingOnlyAdapter implements ProviderAdapter {
  readonly apiType = 'fake-streaming'

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    return {
      id: 'resp-fallback',
      content: [{ type: 'text', text: 'fallback' }],
      stopReason: 'end_turn',
      usage: { input: 1, output: 1 },
      model: 'fake',
    }
  }

  async *stream(_req: CompletionRequest): AsyncIterable<StreamEvent> {
    yield { type: 'text_delta', data: { text: 'hello' } }
    yield { type: 'text_delta', data: { text: ' world' } }
    yield { type: 'done', data: { finishReason: 'end_turn', usage: { input: 3, output: 2 }, model: 'fake' } }
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

class FallbackAdapter implements ProviderAdapter {
  readonly apiType = 'fake-fallback'
  completeCalls = 0

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    this.completeCalls += 1
    return {
      id: 'resp-fallback',
      content: [{ type: 'text', text: 'fallback worked' }],
      stopReason: 'end_turn',
      usage: { input: 1, output: 1 },
      model: 'fake-fallback',
    }
  }

  async *stream(_req: CompletionRequest): AsyncIterable<StreamEvent> {
    throw new Error('stream failed')
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

class AnthropicFailingAdapter implements ProviderAdapter {
  readonly apiType = 'anthropic_messages'
  completeCalls = 0

  constructor(private streamError: Error & { status?: number; request_id?: string }) {}

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    this.completeCalls += 1
    return {
      id: 'resp-should-not-run',
      content: [{ type: 'text', text: 'unexpected fallback' }],
      stopReason: 'end_turn',
      usage: { input: 1, output: 1 },
      model: 'claude-test',
    }
  }

  async *stream(_req: CompletionRequest): AsyncIterable<StreamEvent> {
    throw this.streamError
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

function createAgent(adapter: ProviderAdapter, logger?: ToolContext['logger']): Agent {
  return new Agent(
    {
      name: 'stream-agent',
      systemPrompt: 'test',
    },
    adapter,
    new ToolRegistry(),
    {
      sessionId: 'sess-stream',
      workDir: process.cwd(),
      logger: logger ?? { info: () => {}, warn: () => {}, error: () => {} },
    }
  )
}

function createContext(): AgentContext {
  return {
    systemPrompt: 'test',
    conversationHistory: [],
    tools: [],
  }
}

describe('Agent streaming callback', () => {
  test('run emits text deltas and returns assistant text', async () => {
    const adapter = new StreamingOnlyAdapter()
    const agent = createAgent(adapter)

    const deltas: string[] = []
    const messages = await agent.run(
      createContext(),
      'say hi',
      undefined,
      undefined,
      (delta) => deltas.push(delta)
    )

    expect(deltas).toEqual(['hello', ' world'])

    const assistant = messages.find((m) => m.role === 'assistant')
    expect(assistant).toBeDefined()
    const text = assistant!.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    expect(text).toBe('hello world')
  })

  test('non-Anthropic stream errors still fallback to complete', async () => {
    const adapter = new FallbackAdapter()
    const warnings: Array<Record<string, unknown>> = []
    const agent = createAgent(adapter, {
      info: () => {},
      warn: (_event, data) => warnings.push(data ?? {}),
      error: () => {},
    })

    const messages = await agent.run(createContext(), 'say hi')
    const assistant = messages.find((m) => m.role === 'assistant')

    expect(adapter.completeCalls).toBeGreaterThanOrEqual(1)
    expect(assistant?.content).toEqual([{ type: 'text', text: 'fallback worked' }])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      apiType: 'fake-fallback',
      fallbackSkipped: false,
    })
  })

  test('Anthropic API errors do not fallback to complete', async () => {
    const streamError = Object.assign(new Error('429 rate limited'), {
      status: 429,
      request_id: 'req_123',
    })
    const adapter = new AnthropicFailingAdapter(streamError)
    const warnings: Array<Record<string, unknown>> = []
    const agent = createAgent(adapter, {
      info: () => {},
      warn: (_event, data) => warnings.push(data ?? {}),
      error: () => {},
    })

    await expect(agent.run(createContext(), 'say hi')).rejects.toThrow('429 rate limited')

    expect(adapter.completeCalls).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      apiType: 'anthropic_messages',
      status: 429,
      requestId: 'req_123',
      fallbackSkipped: true,
    })
  })

  test('Anthropic SDK streaming guidance errors do not fallback to complete', async () => {
    const streamError = new Error(
      'Streaming is strongly recommended for operations that may take longer than 10 minutes.'
    )
    const adapter = new AnthropicFailingAdapter(streamError)
    const warnings: Array<Record<string, unknown>> = []
    const agent = createAgent(adapter, {
      info: () => {},
      warn: (_event, data) => warnings.push(data ?? {}),
      error: () => {},
    })

    await expect(agent.run(createContext(), 'say hi')).rejects.toThrow(
      'Streaming is strongly recommended'
    )

    expect(adapter.completeCalls).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      apiType: 'anthropic_messages',
      fallbackSkipped: true,
    })
  })
})
