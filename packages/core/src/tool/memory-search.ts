import { BaseTool } from './base'
import type { MemoryType, ToolContext, ToolResult } from '@zero-os/shared'

interface MemorySearchInput {
  query: string
  maxResults?: number
}

const DEFAULT_TYPES: MemoryType[] = ['session', 'incident', 'runbook', 'decision', 'note', 'preference', 'inbox']

export class MemorySearchTool extends BaseTool {
  name = 'memory_search'
  description = '搜索 `.zero/memory/**` 中的相关记忆片段。回答过往工作、决策、偏好、待办前优先使用。'
  parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query for relevant memories' },
      maxResults: { type: 'number', description: 'Maximum results to return' },
    },
    required: ['query'],
  }

  protected async execute(ctx: ToolContext, input: unknown): Promise<ToolResult> {
    const { query, maxResults } = input as MemorySearchInput

    if (!ctx.memoryRetriever) {
      return {
        success: false,
        output: 'Memory retriever not available',
        outputSummary: 'Memory retriever not configured',
      }
    }

    const results = ctx.memoryRetriever.retrieveScored
      ? await ctx.memoryRetriever.retrieveScored(query, { topN: maxResults ?? 5, types: DEFAULT_TYPES, confidenceThreshold: 0 })
      : (await ctx.memoryRetriever.retrieve(query, { topN: maxResults ?? 5, types: DEFAULT_TYPES, confidenceThreshold: 0 }))
        .map(memory => ({ memory, score: 0 }))

    if (results.length === 0) {
      return {
        success: true,
        output: `No relevant memories found for query: ${query}`,
        outputSummary: 'No relevant memories found',
      }
    }

    const output = results
      .map((entry, index) => {
        const path = ctx.memoryStore?.getRelativePath?.(entry.memory.type, entry.memory.id) ?? `${entry.memory.type}/${entry.memory.id}`
        const snippet = truncateSnippet(entry.memory.content)
        return [
          `${index + 1}. [${entry.memory.type}] ${entry.memory.title}`,
          `   id: ${entry.memory.id}`,
          `   path: ${path}`,
          `   score: ${entry.score}`,
          `   snippet: ${snippet}`,
        ].join('\n')
      })
      .join('\n\n')

    return {
      success: true,
      output,
      outputSummary: `Found ${results.length} relevant memories`,
    }
  }
}

function truncateSnippet(content: string, maxLength = 240): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}
