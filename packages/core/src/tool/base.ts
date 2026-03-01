import type { ToolContext, ToolResult } from '@zero-os/shared'

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
   * Post-execution hook - release locks, write logs.
   */
  protected async afterExecute(ctx: ToolContext, result: ToolResult): Promise<void> {
    ctx.logger.info('tool_call_complete', {
      tool: this.name,
      success: result.success,
      outputSummary: result.outputSummary,
    })
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
      await this.afterExecute(ctx, result)
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const result: ToolResult = {
        success: false,
        output: errorMessage,
        outputSummary: `Error: ${errorMessage.slice(0, 100)}`,
      }
      ctx.logger.error('tool_call_error', {
        tool: this.name,
        error: errorMessage,
        durationMs: Date.now() - startTime,
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
