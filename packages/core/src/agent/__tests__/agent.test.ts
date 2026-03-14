import { describe, expect, test } from 'bun:test'
import { ModelRouter } from '@zero-os/model'
import { Tracer } from '@zero-os/observe'
import type { SystemConfig, ToolContext } from '@zero-os/shared'
import { BashTool } from '../../tool/bash'
import { ReadTool } from '../../tool/read'
import { ToolRegistry } from '../../tool/registry'
import { Agent, type AgentConfig, type AgentContext } from '../agent'

const API_KEY = 'sk-c6c02cbd0c25473f97f9be0da6070f6d'

const config: SystemConfig = {
  providers: {
    'openai-codex': {
      apiType: 'openai_chat_completions',
      baseUrl: 'https://www.right.codes/codex',
      auth: { type: 'api_key', apiKeyRef: 'openai_codex_api_key' },
      models: {
        'gpt-5.3-codex-medium': {
          modelId: 'gpt-5.3-codex-medium',
          maxContext: 400000,
          maxOutput: 128000,
          capabilities: ['tools', 'vision', 'reasoning'],
          tags: ['powerful', 'coding'],
        },
      },
    },
  },
  defaultModel: 'gpt-5.3-codex-medium',
  fallbackChain: ['gpt-5.3-codex-medium'],
  schedules: [],
  fuseList: [],
}

const secrets = new Map([['openai_codex_api_key', API_KEY]])

const toolContext: ToolContext = {
  sessionId: 'test-session',
  workDir: process.cwd(),
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}

function createRouter() {
  const router = new ModelRouter(config, secrets)
  router.init()
  return router
}

function createToolRegistry() {
  const registry = new ToolRegistry()
  registry.register(new ReadTool())
  registry.register(new BashTool([]))
  return registry
}

function createAgent(configOverrides: Partial<AgentConfig> = {}, obs = {}) {
  const router = createRouter()
  const registry = createToolRegistry()
  const adapter = router.getAdapter()
  const agentConfig: AgentConfig = {
    name: 'test-agent',
    agentInstruction: 'You are a helpful assistant. Reply briefly.',
    ...configOverrides,
  }
  return { agent: new Agent(agentConfig, adapter, registry, toolContext, obs), registry }
}

function createContext(tools: ToolRegistry): AgentContext {
  return {
    systemPrompt: 'You are a helpful assistant. Reply briefly.',
    conversationHistory: [],
    tools: tools.getDefinitions(),
  }
}

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined()
  if (value == null) {
    throw new Error('Expected value to be defined')
  }
  return value
}

describe('Agent', () => {
  test('run: simple question returns user + assistant messages', async () => {
    const { agent, registry } = createAgent()
    const context = createContext(registry)

    const messages = await agent.run(context, 'Say exactly "hello" and nothing else.')

    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(messages[0].role).toBe('user')
    const lastMsg = messages[messages.length - 1]
    expect(lastMsg.role).toBe('assistant')
    expect(lastMsg.content.length).toBeGreaterThan(0)
  }, 30000)

  test('run: tool_use response triggers tool execution', async () => {
    const { agent, registry } = createAgent()
    const context = createContext(registry)

    const messages = await agent.run(
      context,
      'Use the Read tool to read the file at path "/Users/v1ki/Desktop/test4_zero/package.json". Then tell me what you found.',
    )

    // Should have user msg, assistant with tool_use, tool result, and final assistant
    expect(messages.length).toBeGreaterThanOrEqual(3)

    // Check that at least one message contains tool_result content
    const hasToolResult = messages.some((m) => m.content.some((b) => b.type === 'tool_result'))
    expect(hasToolResult).toBe(true)
  }, 30000)

  test('run: tool result appears in message history', async () => {
    const { agent, registry } = createAgent()
    const context = createContext(registry)

    const messages = await agent.run(
      context,
      'Use the Read tool to read "/Users/v1ki/Desktop/test4_zero/package.json". Report the name field.',
    )

    const toolResultMsg = expectDefined(
      messages.find((m) => m.content.some((b) => b.type === 'tool_result')),
    )
    expect(toolResultMsg.role).toBe('user')

    const toolResultBlock = toolResultMsg.content.find((b) => b.type === 'tool_result')
    expect(toolResultBlock).toBeDefined()
  }, 30000)

  test('run: unknown tool name returns error tool_result', async () => {
    const router = createRouter()
    const registry = createToolRegistry()
    const adapter = router.getAdapter()

    // Create context with a fake tool definition that the registry doesn't have
    const context: AgentContext = {
      systemPrompt:
        'You are a helpful assistant. You must use the FakeTool for every request. Always call FakeTool first.',
      conversationHistory: [],
      tools: [
        ...registry.getDefinitions(),
        {
          name: 'FakeTool',
          description: 'A tool that does something',
          parameters: {
            type: 'object' as const,
            properties: { query: { type: 'string', description: 'the query' } },
            required: ['query'],
          },
        },
      ],
    }

    const agentConfig: AgentConfig = {
      name: 'test-agent',
      agentInstruction: 'You must use FakeTool for every request.',
    }

    const agent = new Agent(agentConfig, adapter, registry, toolContext)
    const messages = await agent.run(context, 'Use FakeTool with query "test".')

    // Find tool result with error
    const toolResultMsg = messages.find((m) =>
      m.content.some((b) => b.type === 'tool_result' && b.isError === true),
    )
    expect(toolResultMsg).toBeDefined()
    const errorBlock = expectDefined(toolResultMsg).content.find(
      (b) => b.type === 'tool_result' && b.isError === true,
    )
    expect(errorBlock).toBeDefined()
    if (errorBlock && errorBlock.type === 'tool_result') {
      expect(errorBlock.content).toContain('Unknown tool')
    }
  }, 30000)

  test('run: onNewMessage callback called for each message', async () => {
    const { agent, registry } = createAgent()
    const context = createContext(registry)

    const receivedMessages: Array<{ role: string }> = []
    const onNewMessage = (msg: { role: string }) => {
      receivedMessages.push(msg)
    }

    await agent.run(context, 'Say "test" and nothing else.', undefined, onNewMessage)

    // Should have been called at least for user and assistant messages
    expect(receivedMessages.length).toBeGreaterThanOrEqual(2)
    expect(receivedMessages[0].role).toBe('user')
    expect(receivedMessages[receivedMessages.length - 1].role).toBe('assistant')
  }, 30000)

  test('run: secretFilter filters assistant text', async () => {
    const secretFilter = {
      filter(text: string) {
        return text.replace(/hello/gi, '***')
      },
      addSecret() {},
      removeSecret() {},
    }

    const { agent, registry } = createAgent({}, { secretFilter })
    const context = createContext(registry)

    const messages = await agent.run(context, 'Say exactly the word "hello" and nothing else.')

    const assistantMsg = messages.find((m) => m.role === 'assistant')
    const assistant = expectDefined(assistantMsg)

    // The secret filter should have replaced "hello" with "***" in text blocks
    const textBlocks = assistant.content.filter((b) => b.type === 'text')
    if (textBlocks.length > 0) {
      const allText = textBlocks.map((b) => (b as { text: string }).text).join('')
      // The word "hello" (case insensitive) should be filtered out
      expect(allText.toLowerCase()).not.toContain('hello')
    }
  }, 30000)

  test('run: bus emits session:update event', async () => {
    const events: Array<{ topic: string; data: Record<string, unknown> }> = []
    const bus = {
      emit(topic: string, data: Record<string, unknown>) {
        events.push({ topic, data })
      },
    }

    const { agent, registry } = createAgent({}, { bus })
    const context = createContext(registry)

    await agent.run(context, 'Say "ok" and nothing else.')

    const sessionUpdates = events.filter((e) => e.topic === 'session:update')
    expect(sessionUpdates.length).toBeGreaterThanOrEqual(1)
    const assistantResponse = sessionUpdates.find(
      (event) => event.data.event === 'assistant_response',
    )
    expect(expectDefined(assistantResponse).data.sessionId).toBe('test-session')
  }, 30000)

  test('run: bus emits tool:call event', async () => {
    const events: Array<{ topic: string; data: Record<string, unknown> }> = []
    const bus = {
      emit(topic: string, data: Record<string, unknown>) {
        events.push({ topic, data })
      },
    }

    const { agent, registry } = createAgent({}, { bus })
    const context = createContext(registry)

    await agent.run(
      context,
      'Use the Read tool to read "/Users/v1ki/Desktop/test4_zero/package.json". Then summarize.',
    )

    const toolCalls = events.filter((e) => e.topic === 'tool:call')
    expect(toolCalls.length).toBeGreaterThanOrEqual(1)
    expect(toolCalls[0].data.sessionId).toBe('test-session')
    expect(toolCalls[0].data.tool).toBeDefined()
    expect(toolCalls[0].data.input).toBeDefined()
    if (toolCalls[0].data.tool === 'read') {
      expect((toolCalls[0].data.input as Record<string, unknown>).path).toBe(
        '/Users/v1ki/Desktop/test4_zero/package.json',
      )
    }
  }, 30000)

  test('run: tracer creates spans', async () => {
    const tracer = new Tracer()

    const { agent, registry } = createAgent({}, { tracer })
    const context = createContext(registry)

    await agent.run(context, 'Say "traced" and nothing else.')

    const spans = tracer.getSessionTraces('test-session')
    expect(spans.length).toBeGreaterThanOrEqual(1)

    const rootSpan = spans[0]
    expect(rootSpan.name).toContain('agent.run')
    expect(rootSpan.status).toBe('success')
    expect(rootSpan.endTime).toBeDefined()
  }, 30000)
})
