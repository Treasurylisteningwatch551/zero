import type { ToolDefinition } from '@zero-os/shared'
import type { BaseTool } from './base'

/**
 * Tool registry — manages available tools for agents.
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map()

  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name)
  }

  list(): BaseTool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Get tool definitions for LLM tool use.
   */
  getDefinitions(): ToolDefinition[] {
    return this.list().map((t) => t.toDefinition())
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }
}
