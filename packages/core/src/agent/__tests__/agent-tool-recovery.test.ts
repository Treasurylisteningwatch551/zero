import { describe, test, expect } from 'bun:test'
import type { CompletionRequest, CompletionResponse, StreamEvent, ToolResult, ToolContext } from '@zero-os/shared'
import { Agent, type AgentContext } from '../agent'
import type { ProviderAdapter } from '@zero-os/model'
import { ToolRegistry } from '../../tool/registry'
import { BaseTool } from '../../tool/base'

class ThrowingTool extends BaseTool {
  name = 'explode'
  description = 'Always throws'
  parameters = {
    type: 'object',
    properties: {},
  }

  // This method is unused because run is overridden to simulate catastrophic tool failures.
  protected async execute(): Promise<ToolResult> {
    return { success: true, output: 'ok', outputSummary: 'ok' }
  }

  async run(_ctx: ToolContext, _input: unknown): Promise<ToolResult> {
    throw new Error('tool crashed unexpectedly')
  }
}

class FakeAdapter implements ProviderAdapter {
  readonly apiType = 'fake'
  private callCount = 0

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    this.callCount++
    if (this.callCount === 1) {
      return {
        id: 'resp_tool_use',
        content: [{ type: 'tool_use', id: 'call_1', name: 'explode', input: {} }],
        stopReason: 'tool_use',
        usage: { input: 10, output: 5 },
        model: 'fake-model',
      }
    }

    return {
      id: 'resp_final',
      content: [{ type: 'text', text: 'recovered' }],
      stopReason: 'end_turn',
      usage: { input: 5, output: 3 },
      model: 'fake-model',
    }
  }

  async *stream(_req: CompletionRequest): AsyncIterable<StreamEvent> {
    yield {
      type: 'done',
      data: { finishReason: 'end_turn' },
    }
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

class EmptyResponseRecoveryAdapter implements ProviderAdapter {
  readonly apiType = 'fake-empty'
  completeCalls = 0

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.completeCalls++
    const lastUserText = [...req.messages]
      .reverse()
      .find((message) => message.role === 'user')
      ?.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('') ?? ''

    if (lastUserText.includes('Your previous reply was empty.')) {
      return {
        id: 'resp_recovered',
        content: [{ type: 'text', text: 'recovered after empty response' }],
        stopReason: 'end_turn',
        usage: { input: 4, output: 4 },
        model: 'fake-model',
      }
    }

    return {
      id: 'resp_empty',
      content: [],
      stopReason: 'end_turn',
      usage: { input: 0, output: 0 },
      model: 'fake-model',
    }
  }

  async *stream(_req: CompletionRequest): AsyncIterable<StreamEvent> {
    yield {
      type: 'done',
      data: { finishReason: 'end_turn' },
    }
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

describe('Agent tool recovery', () => {
  test('run: tool exceptions are converted into tool_result errors', async () => {
    const adapter = new FakeAdapter()
    const registry = new ToolRegistry()
    registry.register(new ThrowingTool())

    const toolContext: ToolContext = {
      sessionId: 'test-session',
      workDir: process.cwd(),
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    }

    const agent = new Agent({
      name: 'test-agent',
      systemPrompt: 'Test prompt',
    }, adapter, registry, toolContext)

    const context: AgentContext = {
      systemPrompt: 'Test prompt',
      conversationHistory: [],
      tools: registry.getDefinitions(),
    }

    const messages = await agent.run(context, 'Trigger explode tool')
    const toolResultMsg = messages.find((m) => m.content.some((b) => b.type === 'tool_result'))
    expect(toolResultMsg).toBeDefined()

    const toolResult = toolResultMsg!.content.find((b) => b.type === 'tool_result')
    expect(toolResult).toBeDefined()
    if (toolResult && toolResult.type === 'tool_result') {
      expect(toolResult.isError).toBe(true)
      expect(toolResult.content).toContain('tool crashed unexpectedly')
    }

    const finalAssistant = messages[messages.length - 1]
    expect(finalAssistant.role).toBe('assistant')
    expect(finalAssistant.content.some((b) => b.type === 'text')).toBe(true)
  })

  test('run: empty completion is retried instead of storing an empty assistant message', async () => {
    const adapter = new EmptyResponseRecoveryAdapter()
    const registry = new ToolRegistry()

    const toolContext: ToolContext = {
      sessionId: 'test-session',
      workDir: process.cwd(),
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    }

    const agent = new Agent({
      name: 'test-agent',
      systemPrompt: 'Test prompt',
    }, adapter, registry, toolContext)

    const context: AgentContext = {
      systemPrompt: 'Test prompt',
      conversationHistory: [],
      tools: registry.getDefinitions(),
    }

    const messages = await agent.run(context, 'Trigger empty response')
    const assistantMessages = messages.filter((m) => m.role === 'assistant')

    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0].content).toEqual([{ type: 'text', text: 'recovered after empty response' }])
    expect(messages.some((m) => m.role === 'assistant' && m.content.length === 0)).toBe(false)
    expect(adapter.completeCalls).toBeGreaterThanOrEqual(2)
  })
})
