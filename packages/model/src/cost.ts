import type { TokenUsage, ModelPricing } from '@zero-os/shared'

/**
 * Compute the cost of a request from token usage and pricing.
 * Prices are per million tokens.
 * Returns 0 if no pricing is provided.
 */
export function computeCost(usage: TokenUsage, pricing?: ModelPricing): number {
  if (!pricing) return 0

  const perM = 1_000_000
  let cost = 0

  cost += (usage.input * pricing.input) / perM
  cost += (usage.output * pricing.output) / perM

  if (usage.cacheWrite && pricing.cacheWrite) {
    cost += (usage.cacheWrite * pricing.cacheWrite) / perM
  }
  if (usage.cacheRead && pricing.cacheRead) {
    cost += (usage.cacheRead * pricing.cacheRead) / perM
  }
  // Reasoning tokens are billed at output rate
  if (usage.reasoning) {
    cost += (usage.reasoning * pricing.output) / perM
  }

  return cost
}
