import { describe, expect, test } from 'bun:test'
import type { ProviderAdapter } from '@zero-os/model'
import { Tracer } from '@zero-os/observe'
import type {
  CompletionRequest,
  CompletionResponse,
  Message,
  StreamEvent,
  ToolContext,
} from '@zero-os/shared'
import { ToolRegistry } from '../../tool/registry'
import { Agent, type AgentContext } from '../agent'
import { TASK_CLOSURE_PROMPT } from '../task-closure'

async function* failStream(error: Error): AsyncIterable<StreamEvent> {
  yield* []
  throw error
}

const OPTIONAL_TAIL = `如果你愿意，我下一步可以继续帮你做两件更有用的事之一：
1. 把里面的已知事实和猜测拆开
2. 去查官方和媒体源，看看哪些引用是真的`

const INITIAL_REPLY = `我先给你一个初步判断：这帖更像高信息密度的传闻汇总，不能直接当事实依据。

${OPTIONAL_TAIL}`

const CONTINUED_REPLY =
  '我已继续核验关键来源。当前没有看到足够官方证据支持帖中的具体发布时间和 benchmark 数字。'

const BLOCK_REPLY = '要继续线上核验，我需要你的账号登录态或截图授权。'

type ClassifierMode = 'continue' | 'finish' | 'block' | 'malformed' | 'throw'

function createTextResponse(text: string): CompletionResponse {
  return {
    id: 'resp_test',
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage: { input: 8, output: 8 },
    model: 'fake-model',
  }
}

function getTextFromMessage(message: Message): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('')
}

function getTextFromRequest(request: CompletionRequest): string {
  return request.messages
    .flatMap((message) => message.content)
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('\n')
}

function getLastUserText(request: CompletionRequest): string {
  for (let index = request.messages.length - 1; index >= 0; index--) {
    const message = request.messages[index]
    if (message.role === 'user') return getTextFromMessage(message)
  }
  return ''
}

function isTaskClosureClassifierRequest(request: CompletionRequest): boolean {
  const text = getTextFromRequest(request)
  return text.includes('任务收尾判定器') && text.includes('<assistant_tail>')
}

class TaskClosureAdapter implements ProviderAdapter {
  readonly apiType = 'fake'
  normalCalls = 0
  classifierCalls = 0
  lastClassifierPrompt = ''
  lastClassifierSystem = ''

  constructor(private readonly mode: ClassifierMode) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (isTaskClosureClassifierRequest(request)) {
      this.classifierCalls++

      if (this.mode === 'throw') {
        throw new Error('classifier failed')
      }

      if (this.mode === 'malformed') {
        return createTextResponse('not-json')
      }

      if (this.mode === 'block') {
        return createTextResponse('{"action":"block","reason":"缺少登录态","trimFrom":""}')
      }

      const prompt = getTextFromRequest(request)
      this.lastClassifierPrompt = prompt
      this.lastClassifierSystem = request.system ?? ''
      if (this.mode === 'continue' && prompt.includes(OPTIONAL_TAIL)) {
        return createTextResponse(
          JSON.stringify({
            action: 'continue',
            reason: '后续核验仍属于当前任务',
            trimFrom: OPTIONAL_TAIL,
          }),
        )
      }

      return createTextResponse('{"action":"finish","reason":"当前回复应直接结束","trimFrom":""}')
    }

    this.normalCalls++

    const lastUserText = getLastUserText(request)
    if (lastUserText.includes(TASK_CLOSURE_PROMPT)) {
      return createTextResponse(CONTINUED_REPLY)
    }

    if (this.mode === 'block') {
      return createTextResponse(BLOCK_REPLY)
    }

    return createTextResponse(INITIAL_REPLY)
  }

  async *stream(_request: CompletionRequest): AsyncIterable<StreamEvent> {
    yield* failStream(new Error('stream not supported in test'))
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}

function createToolContext(): ToolContext {
  return {
    sessionId: 'test-session',
    workDir: process.cwd(),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  }
}

function createContext(registry: ToolRegistry): AgentContext {
  return {
    systemPrompt: 'Test prompt',
    conversationHistory: [],
    tools: registry.getDefinitions(),
  }
}

describe('Agent task closure gate', () => {
  test('continues automatically when classifier marks optional tail as required work', async () => {
    const registry = new ToolRegistry()
    const adapter = new TaskClosureAdapter('continue')
    const agent = new Agent(
      { name: 'test-agent', agentInstruction: 'Test prompt' },
      adapter,
      registry,
      createToolContext(),
    )

    const messages = await agent.run(createContext(registry), '帮我看看这帖值不值得信')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')

    expect(assistantMessages).toHaveLength(2)
    expect(getTextFromMessage(assistantMessages[0])).toBe(
      '我先给你一个初步判断：这帖更像高信息密度的传闻汇总，不能直接当事实依据。',
    )
    expect(getTextFromMessage(assistantMessages[1])).toBe(CONTINUED_REPLY)
    expect(adapter.normalCalls).toBe(2)
    expect(adapter.classifierCalls).toBe(2)
  })

  test('does not auto-continue when user explicitly asks for next-step options', async () => {
    const registry = new ToolRegistry()
    const adapter = new TaskClosureAdapter('finish')
    const agent = new Agent(
      { name: 'test-agent', agentInstruction: 'Test prompt' },
      adapter,
      registry,
      createToolContext(),
    )

    const messages = await agent.run(createContext(registry), '先给我几个下一步选项')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')

    expect(assistantMessages).toHaveLength(1)
    expect(getTextFromMessage(assistantMessages[0])).toContain('如果你愿意')
    expect(adapter.normalCalls).toBe(1)
    expect(adapter.classifierCalls).toBe(1)
  })

  test('does not auto-continue when classifier reports a real blocker', async () => {
    const registry = new ToolRegistry()
    const adapter = new TaskClosureAdapter('block')
    const agent = new Agent(
      { name: 'test-agent', agentInstruction: 'Test prompt' },
      adapter,
      registry,
      createToolContext(),
    )

    const messages = await agent.run(createContext(registry), '继续把线上证据查完')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')

    expect(assistantMessages).toHaveLength(1)
    expect(getTextFromMessage(assistantMessages[0])).toBe(BLOCK_REPLY)
    expect(adapter.normalCalls).toBe(1)
    expect(adapter.classifierCalls).toBe(1)
  })

  test('fails closed when classifier returns malformed JSON', async () => {
    const registry = new ToolRegistry()
    const adapter = new TaskClosureAdapter('malformed')
    const agent = new Agent(
      { name: 'test-agent', agentInstruction: 'Test prompt' },
      adapter,
      registry,
      createToolContext(),
    )

    const messages = await agent.run(createContext(registry), '帮我继续核验')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')

    expect(assistantMessages).toHaveLength(1)
    expect(getTextFromMessage(assistantMessages[0])).toContain('如果你愿意')
    expect(adapter.normalCalls).toBe(1)
    expect(adapter.classifierCalls).toBe(1)
  })

  test('records task closure decisions in tracer metadata', async () => {
    const registry = new ToolRegistry()
    const adapter = new TaskClosureAdapter('continue')
    const tracer = new Tracer()
    const agent = new Agent(
      { name: 'test-agent', agentInstruction: 'Test prompt' },
      adapter,
      registry,
      createToolContext(),
      { tracer },
    )

    await agent.run(createContext(registry), '帮我看看这帖值不值得信')

    const taskClosureSpan = tracer
      .exportSession('test-session')
      .flatMap((span) => [span, ...span.children])
      .find((span) => span.name === 'task_closure_decision')

    expect(taskClosureSpan).toBeDefined()
    expect(taskClosureSpan?.metadata?.called).toBe(true)
    expect(taskClosureSpan?.metadata?.action).toBe('continue')
    expect(taskClosureSpan?.metadata?.userMessagePreview).toBe('帮我看看这帖值不值得信')
    expect(taskClosureSpan?.metadata?.assistantTailPreview).toContain('如果你愿意')
    expect(taskClosureSpan?.metadata?.rawClassifierResponse).toContain('"action":"continue"')
  })

  test('passes explicit system prompt into the classifier request', async () => {
    const registry = new ToolRegistry()
    const adapter = new TaskClosureAdapter('finish')
    const agent = new Agent(
      { name: 'test-agent', agentInstruction: 'Test prompt' },
      adapter,
      registry,
      createToolContext(),
    )

    await agent.run(createContext(registry), '先给我几个下一步选项')
    expect(adapter.lastClassifierSystem).toContain('严格的任务收尾判定器')
  })

  test('passes research-depth context into the classifier prompt', async () => {
    const registry = new ToolRegistry()
    const adapter = new TaskClosureAdapter('continue')
    const agent = new Agent(
      { name: 'test-agent', agentInstruction: 'Test prompt' },
      adapter,
      registry,
      createToolContext(),
    )

    await agent.run(
      createContext(registry),
      '看看 https://example.com 这个内容, 然后把可能相关的信息也分析下, 尽可能深入',
    )

    expect(adapter.lastClassifierPrompt).toContain('research_task=yes')
    expect(adapter.lastClassifierPrompt).toContain('depth_requested=yes')
    expect(adapter.lastClassifierPrompt).toContain('研究/分析类任务额外规则')
  })

  test('fails closed when classifier request throws', async () => {
    const registry = new ToolRegistry()
    const adapter = new TaskClosureAdapter('throw')
    const agent = new Agent(
      { name: 'test-agent', agentInstruction: 'Test prompt' },
      adapter,
      registry,
      createToolContext(),
    )

    const messages = await agent.run(createContext(registry), '帮我继续核验')
    const assistantMessages = messages.filter((message) => message.role === 'assistant')

    expect(assistantMessages).toHaveLength(1)
    expect(getTextFromMessage(assistantMessages[0])).toContain('如果你愿意')
    expect(adapter.normalCalls).toBe(1)
    expect(adapter.classifierCalls).toBe(1)
  })
})
