import type { ToolContext, ToolResult } from '@zero-os/shared'
import { now } from '@zero-os/shared'

/**
 * Abstract base class for all ZeRo OS tools.
 */
export abstract class BaseTool {
  abstract name: string
  abstract description: string
  abstract parameters: Record<string, unknown>

  /**
   * Fuse check - override in tools that execute commands (e.g., Bash).
   */
  protected async fuseCheck(_input: unknown): Promise<void> {}

  /**
   * Pre-execution hook - acquire locks, etc.
   */
  protected async beforeExecute(_ctx: ToolContext, _input: unknown): Promise<void> {}

  /**
   * The actual tool execution logic.
   */
  protected abstract execute(ctx: ToolContext, input: unknown): Promise<ToolResult>

  /**
   * Post-execution hook - release locks, write logs, filter secrets.
   */
  protected async afterExecute(ctx: ToolContext, result: ToolResult, durationMs: number): Promise<void> {
    // Filter secrets from output
    if (ctx.secretFilter) {
      result.output = ctx.secretFilter.filter(result.output)
      result.outputSummary = ctx.secretFilter.filter(result.outputSummary)
    }

    ctx.logger.info('tool_call_complete', {
      tool: this.name,
      success: result.success,
      outputSummary: result.outputSummary,
      durationMs,
    })

    // Structured observability logging
    if (ctx.observability) {
      ctx.observability.logOperation({
        level: result.success ? 'info' : 'error',
        sessionId: ctx.sessionId,
        event: 'tool_call_complete',
        tool: this.name,
        input: '',
        outputSummary: result.outputSummary,
        durationMs,
      })
      ctx.observability.recordOperation({
        sessionId: ctx.sessionId,
        tool: this.name,
        event: 'tool_call_complete',
        success: result.success,
        durationMs,
        createdAt: now(),
      })
    }
  }

  /**
   * Public entry point - the only method callers should use.
   */
  async run(ctx: ToolContext, input: unknown): Promise<ToolResult> {
    const startTime = Date.now()
    try {
      await this.fuseCheck(input)
      await this.beforeExecute(ctx, input)
      const result = await this.execute(ctx, input)
      const durationMs = Date.now() - startTime
      await this.afterExecute(ctx, result, durationMs)
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const durationMs = Date.now() - startTime
      const result: ToolResult = {
        success: false,
        output: errorMessage,
        outputSummary: `Error: ${errorMessage.slice(0, 100)}`,
      }
      ctx.logger.error('tool_call_error', {
        tool: this.name,
        error: errorMessage,
        durationMs,
      })
      return result
    }
  }

  /**
   * Get tool definition for LLM tool use.
   */
  toDefinition(): { name: string; description: string; parameters: Record<string, unknown> } {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    }
  }
}
