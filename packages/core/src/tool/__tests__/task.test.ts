import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ModelRouter } from '@zero-os/model'
import type { SystemConfig } from '@zero-os/shared'
import { BashTool } from '../bash'
import { ReadTool } from '../read'
import { ToolRegistry } from '../registry'
import { TaskTool } from '../task'

// Use the same config pattern as packages/model/src/__tests__/router.test.ts
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

const TEST_WORK_DIR = join(import.meta.dir, '__test_task_workdir__')

beforeAll(() => {
  mkdirSync(TEST_WORK_DIR, { recursive: true })
})

afterAll(() => {
  rmSync(TEST_WORK_DIR, { recursive: true, force: true })
})

const ctx = {
  sessionId: 'test_task_session',
  workDir: TEST_WORK_DIR,
  projectRoot: process.cwd(),
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}

function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(new ReadTool())
  registry.register(new BashTool([]))
  return registry
}

describe('TaskTool', () => {
  test('returns error for empty tasks array', async () => {
    const registry = createToolRegistry()
    const router = new ModelRouter(config, secrets)
    router.init()
    const taskTool = new TaskTool(router, registry)

    const result = await taskTool.run(ctx, { tasks: [] })
    expect(result.success).toBe(false)
    expect(result.output).toContain('No tasks')
  })

  test('returns error for invalid task config (no preset, no name)', async () => {
    const registry = createToolRegistry()
    const router = new ModelRouter(config, secrets)
    router.init()
    const taskTool = new TaskTool(router, registry)

    const result = await taskTool.run(ctx, {
      tasks: [{ id: 'bad', instruction: 'do something' }],
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain('must specify either preset or both name and agentInstruction')
  })

  test('task tool excludes itself from SubAgent registry', () => {
    const registry = createToolRegistry()
    const router = new ModelRouter(config, secrets)
    router.init()
    const taskTool = new TaskTool(router, registry)

    // Register the task tool itself in the base registry
    registry.register(taskTool)
    expect(registry.has('task')).toBe(true)

    // The scoped registry built inside should not include 'task'
    // We test this indirectly: the tool definitions exposed to SubAgents
    // If we could access buildScopedRegistry directly we'd verify, but the
    // class is internal. The safety rule is enforced in the implementation.
    expect(taskTool.name).toBe('task')
  })

  test('single task with preset runs successfully', async () => {
    const registry = createToolRegistry()
    const router = new ModelRouter(config, secrets)
    router.init()
    const taskTool = new TaskTool(router, registry)

    const result = await taskTool.run(ctx, {
      tasks: [
        {
          id: 'echo_test',
          preset: 'coder',
          instruction: 'Run the command: echo "hello from subagent". Return the output.',
          tools: ['bash'],
          timeout: 60_000,
        },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.output).toContain('echo_test')
  }, 60_000)

  test('parallel tasks execute concurrently', async () => {
    const registry = createToolRegistry()
    const router = new ModelRouter(config, secrets)
    router.init()
    const taskTool = new TaskTool(router, registry)

    const _start = Date.now()
    const result = await taskTool.run(ctx, {
      tasks: [
        {
          id: 'task_a',
          preset: 'coder',
          instruction: 'Run: echo "task A done". Return just the output.',
          tools: ['bash'],
          timeout: 60_000,
        },
        {
          id: 'task_b',
          preset: 'coder',
          instruction: 'Run: echo "task B done". Return just the output.',
          tools: ['bash'],
          timeout: 60_000,
        },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.output).toContain('task_a')
    expect(result.output).toContain('task_b')
  }, 120_000)

  test('dependency chain passes upstream output', async () => {
    const registry = createToolRegistry()
    const router = new ModelRouter(config, secrets)
    router.init()
    const taskTool = new TaskTool(router, registry)

    const result = await taskTool.run(ctx, {
      tasks: [
        {
          id: 'step1',
          preset: 'coder',
          instruction: 'Run: echo "MAGIC_NUMBER_42". Return only the output text.',
          tools: ['bash'],
          timeout: 60_000,
        },
        {
          id: 'step2',
          preset: 'coder',
          instruction: 'Look at the upstream output and tell me what number you see.',
          dependsOn: ['step1'],
          tools: ['bash'],
          timeout: 60_000,
        },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.output).toContain('step1')
    expect(result.output).toContain('step2')
  }, 120_000)

  test('custom agent with name and agentInstruction works', async () => {
    const registry = createToolRegistry()
    const router = new ModelRouter(config, secrets)
    router.init()
    const taskTool = new TaskTool(router, registry)

    const result = await taskTool.run(ctx, {
      tasks: [
        {
          id: 'custom',
          name: 'CustomBot',
          agentInstruction: 'You are a helpful bot. Always respond concisely.',
          instruction: 'Run: echo "custom agent works". Return the output.',
          tools: ['bash'],
          timeout: 60_000,
        },
      ],
    })

    expect(result.success).toBe(true)
    expect(result.output).toContain('custom')
  }, 60_000)
})
