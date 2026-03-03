import { estimateTokens } from '@zero-os/shared'

const TOOL_OUTPUT_LIMITS: Record<string, number> = {
  read: 8000,
  write: 500,
  edit: 1000,
  bash: 4000,
  browser: 4000,
  task: 2000,
}

/**
 * Truncate tool output to fit within the tool's token budget.
 * Uses head 60% + tail 20% strategy with an omission marker in the middle.
 */
export function truncateToolOutput(toolName: string, output: string): string {
  const limit = TOOL_OUTPUT_LIMITS[toolName.toLowerCase()] ?? 4000
  const tokens = estimateTokens(output)
  if (tokens <= limit) return output

  const lines = output.split('\n')
  const headCount = Math.ceil(lines.length * 0.6)
  const tailCount = Math.ceil(lines.length * 0.2)
  const head = lines.slice(0, headCount).join('\n')
  const tail = lines.slice(-tailCount).join('\n')

  return [
    head,
    '',
    `... (输出已截断: 原始 ${tokens} tokens, 保留头尾约 ${limit} tokens)`,
    `... (完整输出已写入 operations.jsonl, 可用 Read 工具查看日志)`,
    '',
    tail,
  ].join('\n')
}
