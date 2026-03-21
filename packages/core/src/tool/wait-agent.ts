import type { ToolContext, ToolResult } from '@zero-os/shared'
import { BaseTool } from './base'

interface WaitAgentInput {
  ids: string[]
  timeoutMs?: number
  waitAll?: boolean
}

export class WaitAgentTool extends BaseTool {
  name = 'wait_agent'
  description =
    'Wait for spawned sub-agents to finish. By default returns when any one finishes. Set waitAll=true to wait for all.'
  parameters = {
    type: 'object',
    properties: {
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Agent IDs to observe.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional timeout in milliseconds.',
      },
      waitAll: {
        type: 'boolean',
        description:
          'If true, waits for all agents. Otherwise returns when any requested agent reaches a terminal state.',
      },
    },
    required: ['ids'],
  }

  protected async execute(ctx: ToolContext, input: unknown): Promise<ToolResult> {
    if (!ctx.agentControl) {
      return {
        success: false,
        output: 'Agent control is not available in this session.',
        outputSummary: 'Agent control unavailable',
      }
    }

    const { ids, timeoutMs, waitAll } = input as WaitAgentInput
    const result = waitAll
      ? await ctx.agentControl.waitAll(ids, timeoutMs)
      : await ctx.agentControl.waitAny(ids, timeoutMs)

    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      outputSummary: result.timedOut
        ? `Timed out waiting for ${ids.length} sub-agent(s)`
        : `Observed ${ids.length} sub-agent(s)`,
    }
  }
}
