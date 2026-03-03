import { estimateTokens } from '@zero-os/shared'
import { CONTEXT_PARAMS } from './params'

const TOOL_OUTPUT_LIMITS: Record<string, number> = {
  read: CONTEXT_PARAMS.toolOutput.read,
  write: CONTEXT_PARAMS.toolOutput.write,
  edit: CONTEXT_PARAMS.toolOutput.edit,
  bash: CONTEXT_PARAMS.toolOutput.bash,
  browser: CONTEXT_PARAMS.toolOutput.browser,
  task: CONTEXT_PARAMS.toolOutput.task,
}

/**
 * Truncate tool output to fit within the tool's token budget.
 * Uses head 60% + tail 20% strategy with an omission marker in the middle.
 */
export function truncateToolOutput(toolName: string, output: string): string {
  const limit = TOOL_OUTPUT_LIMITS[toolName.toLowerCase()] ?? CONTEXT_PARAMS.toolOutput.default
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
