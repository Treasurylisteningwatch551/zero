import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelRouter } from '@zero-os/model'
import type { ToolContext, ToolResult } from '@zero-os/shared'
import { Agent, type AgentConfig, type AgentContext } from '../agent/agent'
import { buildSubAgentPrompt } from '../agent/prompt'
import { type TaskNode, TaskOrchestrator, type TaskResult } from '../task/orchestrator'
import { BaseTool } from './base'
import { ToolRegistry } from './registry'

interface SubAgentSpec {
  id: string
  instruction: string
  preset?: string
  name?: string
  agentInstruction?: string
  dependsOn?: string[]
  timeout?: number
  tools?: string[]
}

interface TaskInput {
  tasks: SubAgentSpec[]
}

interface PresetConfig {
  name: string
  agentInstruction: string
  defaultTools: string[]
}

const PRESET_AGENTS: Record<string, PresetConfig> = {
  explorer: {
    name: 'Explorer',
    agentInstruction:
      'You are an Explorer SubAgent for ZeRo OS. Research, investigate, and report findings. Be thorough and concise.',
    defaultTools: ['read', 'bash', 'fetch'],
  },
  coder: {
    name: 'Coder',
    agentInstruction:
      'You are a Coder SubAgent for ZeRo OS. Write, modify, and test code. Make minimal, correct changes.',
    defaultTools: ['read', 'write', 'edit', 'bash'],
  },
  reviewer: {
    name: 'Reviewer',
    agentInstruction:
      'You are a Reviewer SubAgent for ZeRo OS. Review code, identify bugs, and suggest improvements. Do not modify files.',
    defaultTools: ['read', 'bash'],
  },
}

export class TaskTool extends BaseTool {
  name = 'task'
  description =
    'Launch SubAgents to execute specific tasks. Supports preset agents (explorer, coder, reviewer) and custom agents. Tasks can have dependencies for ordered execution.'
  parameters = {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique task ID for dependency references' },
            instruction: { type: 'string', description: 'What the SubAgent should do' },
            preset: {
              type: 'string',
              enum: ['explorer', 'coder', 'reviewer'],
              description: 'Preset SubAgent type',
            },
            name: { type: 'string', description: 'Custom agent name (required if no preset)' },
            agentInstruction: {
              type: 'string',
              description: 'Custom agent role instruction (required if no preset)',
            },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of tasks this depends on',
            },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000)' },
            tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tool names to give the SubAgent',
            },
          },
          required: ['id', 'instruction'],
        },
        description: 'Array of SubAgent tasks with optional dependencies',
      },
    },
    required: ['tasks'],
  }

  private modelRouter: ModelRouter
  private baseToolRegistry: ToolRegistry
  private orchestrator = new TaskOrchestrator()

  constructor(modelRouter: ModelRouter, baseToolRegistry: ToolRegistry) {
    super()
    this.modelRouter = modelRouter
    this.baseToolRegistry = baseToolRegistry
  }

  protected async execute(ctx: ToolContext, input: unknown): Promise<ToolResult> {
    const { tasks } = input as TaskInput

    if (!tasks || tasks.length === 0) {
      return { success: false, output: 'No tasks provided', outputSummary: 'No tasks' }
    }

    // Validate and build TaskNodes
    const nodes: TaskNode[] = []
    for (const spec of tasks) {
      const config = this.resolveAgentConfig(spec)
      if (!config) {
        return {
          success: false,
          output: `Task "${spec.id}": must specify either preset or both name and agentInstruction`,
          outputSummary: 'Invalid task config',
        }
      }

      nodes.push({
        id: spec.id,
        agentConfig: config,
        instruction: spec.instruction,
        dependsOn: spec.dependsOn ?? [],
        timeout: spec.timeout ?? 120_000,
      })
    }

    // Execute task graph
    const executor = async (
      node: TaskNode,
      upstreamResults: Map<string, TaskResult>,
    ): Promise<TaskResult> => {
      const startTime = Date.now()

      // Build instruction with upstream context
      let fullInstruction = node.instruction
      if (node.dependsOn.length > 0) {
        const upstreamContext = node.dependsOn
          .map((depId) => {
            const result = upstreamResults.get(depId)
            return result ? `## Output from task "${depId}":\n${result.output}` : ''
          })
          .filter(Boolean)
          .join('\n\n')

        if (upstreamContext) {
          fullInstruction = `${upstreamContext}\n\n---\n\n## Your task:\n${node.instruction}`
        }
      }

      // Find the matching spec to get tools list
      const spec = tasks.find((t) => t.id === node.id)
      const scopedRegistry = this.buildScopedRegistry(spec)

      // Create SubAgent with isolated workspace
      const resolvedModel = ctx.currentModel
        ? this.modelRouter.resolveModel(ctx.currentModel)
        : this.modelRouter.getCurrentModel()
      const adapter = resolvedModel?.adapter ?? this.modelRouter.getAdapter()
      const subAgentName = spec?.name ?? spec?.preset ?? node.id
      const subWorkDir = join(ctx.workDir, subAgentName)
      if (!existsSync(subWorkDir)) {
        mkdirSync(subWorkDir, { recursive: true })
      }
      const toolContext: ToolContext = {
        sessionId: `${ctx.sessionId}_sub_${node.id}`,
        currentModel: resolvedModel
          ? this.modelRouter.getModelLabel(resolvedModel)
          : ctx.currentModel,
        workDir: subWorkDir,
        projectRoot: ctx.projectRoot,
        logger: ctx.logger,
        secretFilter: ctx.secretFilter,
      }

      const agent = new Agent(node.agentConfig, adapter, scopedRegistry, toolContext)

      // Build structured SubAgent prompt with upstream results
      const subAgentSystemPrompt = buildSubAgentPrompt(
        scopedRegistry.getDefinitions(),
        node.instruction,
        node.agentConfig.agentInstruction,
        upstreamResults as Map<string, { output: string; success: boolean }>,
        node.dependsOn,
      )

      const agentContext: AgentContext = {
        systemPrompt: subAgentSystemPrompt,
        conversationHistory: [],
        tools: scopedRegistry.getDefinitions(),
      }

      const messages = await agent.run(agentContext, fullInstruction)

      // Extract assistant text from the last message
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
      const output =
        lastAssistant?.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { type: 'text'; text: string }).text)
          .join('\n') ?? ''

      return {
        nodeId: node.id,
        success: true,
        output,
        durationMs: Date.now() - startTime,
      }
    }

    const results = await this.orchestrator.execute(nodes, executor)

    // Format output
    const outputParts: string[] = []
    let allSuccess = true
    for (const [id, result] of results) {
      const status = result.success ? 'SUCCESS' : 'FAILED'
      if (!result.success) allSuccess = false
      outputParts.push(`### Task "${id}" [${status}] (${result.durationMs}ms)\n${result.output}`)
    }

    const output = outputParts.join('\n\n---\n\n')
    const summary = allSuccess
      ? `All ${results.size} tasks completed successfully`
      : `${results.size} tasks completed with failures`

    return { success: allSuccess, output, outputSummary: summary }
  }

  private resolveAgentConfig(spec: SubAgentSpec): AgentConfig | null {
    if (spec.preset) {
      const preset = PRESET_AGENTS[spec.preset]
      if (!preset) return null
      return {
        name: spec.name ?? preset.name,
        agentInstruction: spec.agentInstruction ?? preset.agentInstruction,
      }
    }

    if (spec.name && spec.agentInstruction) {
      return {
        name: spec.name,
        agentInstruction: spec.agentInstruction,
      }
    }

    return null
  }

  private buildScopedRegistry(spec: SubAgentSpec | undefined): ToolRegistry {
    const scopedRegistry = new ToolRegistry()
    const preset = spec?.preset ? PRESET_AGENTS[spec.preset] : null
    const toolNames = spec?.tools ?? preset?.defaultTools ?? ['read', 'bash']

    for (const toolName of toolNames) {
      // Never include 'task' in SubAgent registry to prevent recursion
      if (toolName === 'task') continue

      const tool = this.baseToolRegistry.get(toolName)
      if (tool) {
        scopedRegistry.register(tool)
      }
    }

    return scopedRegistry
  }
}
