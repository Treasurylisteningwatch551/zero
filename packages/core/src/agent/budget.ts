import { estimateTokens, truncateToTokens } from '@zero-os/shared'

const FIXED_LIMITS = {
  role: 500,
  toolRules: 800,
  constraints: 300,
  identity: 3000,
  memo: 1500,
  retrievedMemory: 2000,
}

export function allocateBudget(maxContext: number, maxOutput: number): import('@zero-os/shared').ContextBudget {
  const reserved = maxOutput
  const fixedTotal = Object.values(FIXED_LIMITS).reduce((a, b) => a + b, 0)
  const conversation = maxContext - reserved - fixedTotal

  return { ...FIXED_LIMITS, conversation, reserved }
}

export function shouldCompress(conversationTokens: number, conversationBudget: number): boolean {
  return conversationTokens >= conversationBudget * 0.85
}

export function enforceFixedBudget(content: string, limit: number, label: string): string {
  const tokens = estimateTokens(content)
  if (tokens <= limit) return content

  const truncated = truncateToTokens(content, limit - 50)
  return `${truncated}\n\n[${label} 内容过长，已截断。原始长度 ${tokens} tokens，限制 ${limit} tokens。]`
}
