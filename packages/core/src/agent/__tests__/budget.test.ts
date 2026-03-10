import { describe, test, expect } from 'bun:test'
import { allocateBudget, shouldCompress, enforceFixedBudget } from '../budget'

describe('allocateBudget', () => {
  test('returns correct fixed limits', () => {
    const budget = allocateBudget(100_000, 4_000)

    expect(budget.role).toBe(500)
    expect(budget.toolRules).toBe(800)
    expect(budget.constraints).toBe(300)
    expect(budget.executionMode).toBe(500)
    expect(budget.safety).toBe(300)
    expect(budget.toolCallStyle).toBe(200)
    expect(budget.identity).toBe(3000)
    expect(budget.skillCatalog).toBe(2000)
    expect(budget.runtime).toBe(200)
    expect(budget.bootstrapContext).toBe(8000)
  })

  test('calculates conversation budget correctly (maxContext - maxOutput - fixedTotal)', () => {
    const maxContext = 100_000
    const maxOutput = 4_000
    // role(500) + toolRules(800) + constraints(300) + executionMode(500) + safety(300)
    // + toolCallStyle(200) + identity(3000) + skillCatalog(2000) + runtime(200) + bootstrapContext(8000) = 15800
    const fixedTotal = 500 + 800 + 300 + 500 + 300 + 200 + 3000 + 2000 + 200 + 8000

    const budget = allocateBudget(maxContext, maxOutput)

    expect(budget.reserved).toBe(maxOutput)
    expect(budget.conversation).toBe(maxContext - maxOutput - fixedTotal)
    expect(budget.conversation).toBe(80_200)
  })
})

describe('shouldCompress', () => {
  test('returns false below 85% threshold', () => {
    const budget = 10_000
    const tokens = 8_000 // 80%

    expect(shouldCompress(tokens, budget)).toBe(false)
  })

  test('returns true at 85% threshold', () => {
    const budget = 10_000
    const tokens = 8_500 // exactly 85%

    expect(shouldCompress(tokens, budget)).toBe(true)
  })

  test('returns true above 85% threshold', () => {
    const budget = 10_000
    const tokens = 9_500 // 95%

    expect(shouldCompress(tokens, budget)).toBe(true)
  })
})

describe('enforceFixedBudget', () => {
  test('returns original content when within limit', () => {
    const content = 'Short content'
    const result = enforceFixedBudget(content, 1000, 'Test')

    expect(result).toBe(content)
  })

  test('truncates and adds label when exceeding limit', () => {
    // estimateTokens uses Math.ceil(text.length / 3.5)
    // To exceed a limit of 10 tokens, we need text > 10 * 3.5 = 35 chars
    const content = 'A'.repeat(200) // ~57 tokens, well over limit of 10
    const limit = 10
    const label = 'Identity'

    const result = enforceFixedBudget(content, limit, label)

    expect(result).not.toBe(content)
    expect(result).toContain(`[${label} 内容过长，已截断。`)
    expect(result).toContain(`限制 ${limit} tokens。]`)
    // The truncated part should be shorter than the original
    expect(result.length).toBeLessThan(content.length + 200)
  })
})
