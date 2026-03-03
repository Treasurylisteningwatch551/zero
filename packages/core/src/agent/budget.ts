import { estimateTokens, truncateToTokens } from '@zero-os/shared'
import { CONTEXT_PARAMS } from './params'

const FIXED_LIMITS = CONTEXT_PARAMS.budget

export function allocateBudget(maxContext: number, maxOutput: number): import('@zero-os/shared').ContextBudget {
  const reserved = maxOutput
  const fixedTotal = Object.values(FIXED_LIMITS).reduce((a, b) => a + b, 0)
  const conversation = maxContext - reserved - fixedTotal

  return { ...FIXED_LIMITS, conversation, reserved }
}

export function shouldCompress(conversationTokens: number, conversationBudget: number): boolean {
  return conversationTokens >= conversationBudget * CONTEXT_PARAMS.compression.threshold
}

export function enforceFixedBudget(content: string, limit: number, label: string): string {
  const tokens = estimateTokens(content)
  if (tokens <= limit) return content

  const truncated = truncateToTokens(content, limit - 50)
  return `${truncated}\n\n[${label} 内容过长，已截断。原始长度 ${tokens} tokens，限制 ${limit} tokens。]`
}
