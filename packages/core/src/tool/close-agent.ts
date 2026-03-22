import type { ToolContext, ToolResult } from '@zero-os/shared'
import { BaseTool } from './base'

interface CloseAgentInput {
  agentId?: string
  id?: string
  agent_id?: string
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
      id: {
        type: 'string',
        description: 'Alias for agentId.',
      },
      agent_id: {
        type: 'string',
        description: 'Alias for agentId matching spawn_agent output.',
      },
    },
  }

  protected async execute(ctx: ToolContext, input: unknown): Promise<ToolResult> {
    if (!ctx.agentControl) {
      return {
        success: false,
        output: 'Agent control is not available in this session.',
        outputSummary: 'Agent control unavailable',
      }
    }

    const { agentId, id, agent_id } = input as CloseAgentInput
    const resolvedAgentId = agentId ?? id ?? agent_id
    if (!resolvedAgentId?.trim()) {
      return {
        success: false,
        output: 'agentId is required.',
        outputSummary: 'Missing agentId',
      }
    }
    const traceSpanId = ctx.agentControl.getTraceSpanId(resolvedAgentId)
    const status = ctx.agentControl.close(resolvedAgentId)

    if (ctx.currentTraceSpanId) {
      ctx.tracer?.updateSpan(ctx.currentTraceSpanId, {
        data: {
          targetAgentId: resolvedAgentId,
          targetSubAgentSpanId: traceSpanId,
          closeSucceeded: Boolean(status),
          resultingState: status?.state,
        },
        metadata: {
          targetAgentId: resolvedAgentId,
          targetSubAgentSpanId: traceSpanId,
          closeSucceeded: Boolean(status),
          resultingState: status?.state,
        },
      })
    }

    if (!status) {
      return {
        success: false,
        output: `Sub-agent "${resolvedAgentId}" was not found.`,
        outputSummary: 'Sub-agent not found',
      }
    }

    return {
      success: true,
      output: JSON.stringify(status, null, 2),
      outputSummary: `Closed sub-agent "${resolvedAgentId}"`,
    }
  }
}
