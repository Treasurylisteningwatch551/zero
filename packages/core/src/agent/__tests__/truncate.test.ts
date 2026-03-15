import { describe, expect, test } from 'bun:test'
import { truncateToolOutput } from '../truncate'

describe('truncateToolOutput', () => {
  test('returns original output when within limit for read tool', () => {
    const output = 'Hello world\nThis is a small file.'
    const result = truncateToolOutput('read', output)
    expect(result).toBe(output)
  })

  test('returns original output for short write tool output', () => {
    const output = 'File written successfully.'
    const result = truncateToolOutput('write', output)
    expect(result).toBe(output)
  })

  test('truncates long bash output exceeding 4000 tokens', () => {
    const output = 'x\n'.repeat(20000)
    const result = truncateToolOutput('bash', output)
    expect(result.length).toBeLessThan(output.length)
  })

  test('truncated output contains omission marker with Chinese text', () => {
    const output = 'x\n'.repeat(20000)
    const result = truncateToolOutput('bash', output)
    expect(result).toContain('输出已截断')
    expect(result).toContain('会记录到后续请求的 requests.jsonl')
  })

  test('truncated output contains head and tail sections', () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `line-${i}`)
    const output = lines.join('\n')
    const result = truncateToolOutput('bash', output)

    // Head: first 60% of lines should be present
    expect(result).toContain('line-0')
    expect(result).toContain('line-1')

    // Tail: last 20% of lines should be present
    expect(result).toContain(`line-${20000 - 1}`)
    expect(result).toContain(`line-${20000 - 2}`)
  })

  test('uses default 4000 limit for unknown tool names', () => {
    // Generate output that exceeds 4000 tokens but is under 8000 (read limit)
    // estimateTokens uses Math.ceil(text.length / 3.5)
    // 4000 tokens * 3.5 = 14000 chars. Generate ~18000 chars to exceed 4000 tokens.
    const output = 'ab\n'.repeat(6000) // 6000 * 3 = 18000 chars => ~5143 tokens
    const resultUnknown = truncateToolOutput('unknown_tool', output)
    expect(resultUnknown).toContain('输出已截断')

    // Same output should NOT be truncated for 'read' (limit 8000)
    const resultRead = truncateToolOutput('read', output)
    expect(resultRead).toBe(output)
  })

  test('case-insensitive tool name matching', () => {
    const smallOutput = 'Hello world'

    // Both 'Read' and 'read' should use the same limit (8000)
    const resultUpper = truncateToolOutput('Read', smallOutput)
    const resultLower = truncateToolOutput('read', smallOutput)
    expect(resultUpper).toBe(resultLower)
    expect(resultUpper).toBe(smallOutput)

    // Verify with a large output that 'BASH' and 'bash' behave the same
    const largeOutput = 'x\n'.repeat(20000)
    const resultBashUpper = truncateToolOutput('BASH', largeOutput)
    const resultBashLower = truncateToolOutput('bash', largeOutput)
    expect(resultBashUpper).toBe(resultBashLower)
    expect(resultBashUpper).toContain('输出已截断')
  })
})
