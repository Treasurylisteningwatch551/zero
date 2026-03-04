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

describe('Agent streaming callback', () => {
  test('run emits text deltas and returns assistant text', async () => {
    const adapter = new StreamingOnlyAdapter()
    const registry = new ToolRegistry()

    const toolContext: ToolContext = {
      sessionId: 'sess-stream',
      workDir: process.cwd(),
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    }

    const agent = new Agent(
      {
        name: 'stream-agent',
        systemPrompt: 'test',
      },
      adapter,
      registry,
      toolContext
    )

    const context: AgentContext = {
      systemPrompt: 'test',
      conversationHistory: [],
      tools: [],
    }

    const deltas: string[] = []
    const messages = await agent.run(
      context,
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
})
