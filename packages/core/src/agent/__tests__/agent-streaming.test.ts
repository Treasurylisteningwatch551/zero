import { describe, expect, test } from 'bun:test'
import type { ProviderAdapter } from '@zero-os/model'
import { JsonlLogger } from '@zero-os/observe'
import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  ToolContext,
  ToolResult,
} from '@zero-os/shared'
import { BaseTool } from '../../tool/base'
import { ToolRegistry } from '../../tool/registry'
import { Agent, type AgentContext } from '../agent'

async function* failStream(error: Error): AsyncIterable<StreamEvent> {
  yield* []
  throw error
}

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
    yield {
      type: 'done',
      data: { finishReason: 'end_turn', usage: { input: 3, output: 2 }, model: 'fake' },
    }
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

class ReasoningStreamingAdapter implements ProviderAdapter {
  readonly apiType = 'fake-reasoning'

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    return {
      id: 'resp-reasoning',
      content: [{ type: 'text', text: 'fallback' }],
      stopReason: 'end_turn',
      usage: { input: 1, output: 1, reasoning: 2 },
      model: 'fake-reasoning',
      reasoningContent: 'fallback reasoning',
    }
  }

  async *stream(_req: CompletionRequest): AsyncIterable<StreamEvent> {
    yield { type: 'reasoning_delta', data: { text: 'step 1. ' } }
    yield { type: 'reasoning_delta', data: { text: 'step 2.' } }
    yield { type: 'text_delta', data: { text: 'visible answer' } }
    yield {
      type: 'done',
      data: {
        finishReason: 'end_turn',
        usage: { input: 3, output: 2, reasoning: 7 },
        model: 'fake-reasoning',
      },
    }
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
    yield* failStream(new Error('stream failed'))
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

class NoopTool extends BaseTool {
  name = 'noop'
  description = 'Returns ok'
  parameters = { type: 'object', properties: {} }

  protected async execute(_ctx: ToolContext, _input: unknown): Promise<ToolResult> {
    return { success: true, output: 'ok', outputSummary: 'ok' }
  }
}

class ToolLoopAdapter implements ProviderAdapter {
  readonly apiType = 'fake-tool-loop'
  completeCalls = 0

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    this.completeCalls += 1

    if (this.completeCalls === 1) {
      return {
        id: 'resp_tool_1',
        content: [{ type: 'tool_use', id: 'call_1', name: 'noop', input: {} }],
        stopReason: 'tool_use',
        usage: { input: 5, output: 2 },
        model: 'fake-tool-loop',
      }
    }

    if (this.completeCalls === 2) {
      return {
        id: 'resp_tool_2',
        content: [{ type: 'tool_use', id: 'call_2', name: 'noop', input: {} }],
        stopReason: 'tool_use',
        usage: { input: 6, output: 2 },
        model: 'fake-tool-loop',
      }
    }

    return {
      id: 'resp_final',
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
      usage: { input: 7, output: 3 },
      model: 'fake-tool-loop',
    }
  }

  async *stream(_req: CompletionRequest): AsyncIterable<StreamEvent> {
    yield* failStream(new Error('stream failed'))
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
    yield* failStream(this.streamError)
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

function createAgent(adapter: ProviderAdapter, logger?: ToolContext['logger']): Agent {
  return new Agent(
    {
      name: 'stream-agent',
      agentInstruction: 'test',
    },
    adapter,
    new ToolRegistry(),
    {
      sessionId: 'sess-stream',
      workDir: process.cwd(),
      logger: logger ?? { info: () => {}, warn: () => {}, error: () => {} },
    },
    {},
  )
}

function createContext(): AgentContext {
  return {
    systemPrompt: 'test',
    conversationHistory: [],
    tools: [],
  }
}

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined()
  if (value == null) {
    throw new Error('Expected value to be defined')
  }
  return value
}

describe('Agent streaming callback', () => {
  test('run emits text deltas and returns assistant text', async () => {
    const adapter = new StreamingOnlyAdapter()
    const agent = createAgent(adapter)

    const deltas: string[] = []
    const messages = await agent.run(createContext(), 'say hi', undefined, undefined, (delta) =>
      deltas.push(delta),
    )

    expect(deltas).toEqual(['hello', ' world'])

    const assistant = messages.find((m) => m.role === 'assistant')
    const text = expectDefined(assistant)
      .content.filter((b) => b.type === 'text')
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

  test('Anthropic SSE JSON errors do not fallback to complete', async () => {
    const streamError = new Error(
      JSON.stringify({
        type: 'error',
        error: {
          details: null,
          type: 'overloaded_error',
          message: 'Overloaded',
        },
        request_id: 'req_456',
      }),
    )
    const adapter = new AnthropicFailingAdapter(streamError)
    const warnings: Array<Record<string, unknown>> = []
    const agent = createAgent(adapter, {
      info: () => {},
      warn: (_event, data) => warnings.push(data ?? {}),
      error: () => {},
    })

    await expect(agent.run(createContext(), 'say hi')).rejects.toThrow('Overloaded')

    expect(adapter.completeCalls).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      apiType: 'anthropic_messages',
      requestId: 'req_456',
      fallbackSkipped: true,
    })
  })

  test('Anthropic SDK streaming guidance errors do not fallback to complete', async () => {
    const streamError = new Error(
      'Streaming is strongly recommended for operations that may take longer than 10 minutes.',
    )
    const adapter = new AnthropicFailingAdapter(streamError)
    const warnings: Array<Record<string, unknown>> = []
    const agent = createAgent(adapter, {
      info: () => {},
      warn: (_event, data) => warnings.push(data ?? {}),
      error: () => {},
    })

    await expect(agent.run(createContext(), 'say hi')).rejects.toThrow(
      'Streaming is strongly recommended',
    )

    expect(adapter.completeCalls).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      apiType: 'anthropic_messages',
      fallbackSkipped: true,
    })
  })

  test('reasoning deltas are aggregated and logged to session requests', async () => {
    const entries: Array<Record<string, unknown>> = []
    const adapter = new ReasoningStreamingAdapter()
    const logger = Object.assign(Object.create(JsonlLogger.prototype), {
      logSessionRequest(entry: Record<string, unknown>) {
        entries.push(entry)
      },
      logSessionClosure() {},
    }) as JsonlLogger
    const agent = new Agent(
      {
        name: 'stream-agent',
        agentInstruction: 'test',
      },
      adapter,
      new ToolRegistry(),
      {
        sessionId: 'sess-stream',
        workDir: process.cwd(),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      },
      {
        logger,
      },
    )

    const messages = await agent.run(createContext(), 'reason please')
    const assistant = messages.find((m) => m.role === 'assistant')
    const visibleText = assistant?.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('')

    expect(visibleText).toBe('visible answer')
    expect(entries).toHaveLength(1)
    expect(entries[0].reasoningContent).toBe('step 1. step 2.')
    expect(entries[0].toolCalls).toEqual([])
    expect((entries[0].tokens as Record<string, unknown>).reasoning).toBe(7)
  })

  test('tool_use retries share turnIndex and chain parentId to the prior response id', async () => {
    const entries: Array<Record<string, unknown>> = []
    const adapter = new ToolLoopAdapter()
    const registry = new ToolRegistry()
    registry.register(new NoopTool())
    const logger = Object.assign(Object.create(JsonlLogger.prototype), {
      logSessionRequest(entry: Record<string, unknown>) {
        entries.push(entry)
      },
      logSessionClosure() {},
    }) as JsonlLogger
    const agent = new Agent(
      {
        name: 'stream-agent',
        agentInstruction: 'test',
      },
      adapter,
      registry,
      {
        sessionId: 'sess-stream',
        workDir: process.cwd(),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      },
      {
        logger,
      },
    )

    const messages = await agent.run(
      createContext(),
      'use tools',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        turnIndex: 4,
      },
    )

    expect(messages.at(-1)?.role).toBe('assistant')
    expect(entries).toHaveLength(3)
    expect(entries.map((entry) => entry.turnIndex)).toEqual([4, 4, 4])
    expect(entries.map((entry) => entry.parentId ?? null)).toEqual([
      null,
      'resp_tool_1',
      'resp_tool_2',
    ])
    expect(entries.map((entry) => entry.id)).toEqual(['resp_tool_1', 'resp_tool_2', 'resp_final'])
    expect(entries.map((entry) => entry.toolCalls)).toEqual([
      [{ id: 'call_1', name: 'noop', input: {} }],
      [{ id: 'call_2', name: 'noop', input: {} }],
      [],
    ])
  })
})
