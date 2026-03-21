import type { ToolContext, ToolResult } from '@zero-os/shared'
import { BaseTool } from './base'

interface CloseAgentInput {
  agentId: string
}

export class CloseAgentTool extends BaseTool {
  name = 'close_agent'
  description = 'Close a spawned sub-agent and release its controller state.'
  parameters = {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'The spawned agent_id to close.',
      },
    },
    required: ['agentId'],
  }

  protected async execute(ctx: ToolContext, input: unknown): Promise<ToolResult> {
    if (!ctx.agentControl) {
      return {
        success: false,
        output: 'Agent control is not available in this session.',
        outputSummary: 'Agent control unavailable',
      }
    }

    const { agentId } = input as CloseAgentInput
    const status = ctx.agentControl.close(agentId)
    if (!status) {
      return {
        success: false,
        output: `Sub-agent "${agentId}" was not found.`,
        outputSummary: 'Sub-agent not found',
      }
    }

    return {
      success: true,
      output: JSON.stringify(status, null, 2),
      outputSummary: `Closed sub-agent "${agentId}"`,
    }
  }
}
