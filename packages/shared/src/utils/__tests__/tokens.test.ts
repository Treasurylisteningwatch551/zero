import { describe, test, expect } from 'bun:test'
import { estimateTokens, truncateToTokens, estimateMessageTokens } from '../tokens'
import type { ContentBlock } from '../../types/message'

describe('estimateTokens', () => {
  test('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  test('estimates tokens for English text', () => {
    const text = 'Hello world, this is a test string.'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBe(Math.ceil(text.length / 3.5))
  })

  test('estimates tokens for Chinese text', () => {
    const text = '你好世界，这是一个测试字符串。'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
  })

  test('estimates tokens for mixed Chinese/English text', () => {
    const text = '使用 TypeScript 和 Bun 运行时开发'
    const tokens = estimateTokens(text)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBe(Math.ceil(text.length / 3.5))
  })
})

describe('truncateToTokens', () => {
  test('returns original text when within budget', () => {
    const text = 'short text'
    expect(truncateToTokens(text, 100)).toBe(text)
  })

  test('truncates text exceeding budget', () => {
    const text = 'a'.repeat(1000)
    const result = truncateToTokens(text, 10)
    expect(result.length).toBeLessThanOrEqual(Math.floor(10 * 3.5))
  })

  test('returns empty string for zero budget', () => {
    expect(truncateToTokens('some text', 0)).toBe('')
  })

  test('returns empty string for negative budget', () => {
    expect(truncateToTokens('some text', -5)).toBe('')
  })
})

describe('estimateMessageTokens', () => {
  test('estimates text block tokens', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'Hello world' }]
    expect(estimateMessageTokens(blocks)).toBe(estimateTokens('Hello world'))
  })

  test('estimates tool_use block tokens', () => {
    const blocks: ContentBlock[] = [{
      type: 'tool_use',
      id: 'tc_001',
      name: 'Read',
      input: { path: '/some/file.ts' },
    }]
    const tokens = estimateMessageTokens(blocks)
    expect(tokens).toBeGreaterThan(0)
  })

  test('estimates tool_result block tokens', () => {
    const blocks: ContentBlock[] = [{
      type: 'tool_result',
      toolUseId: 'tc_001',
      content: 'File content here...',
    }]
    expect(estimateMessageTokens(blocks)).toBe(estimateTokens('File content here...'))
  })

  test('estimates image block with fixed value', () => {
    const blocks: ContentBlock[] = [{
      type: 'image',
      mediaType: 'image/png',
      data: 'base64data...',
    }]
    expect(estimateMessageTokens(blocks)).toBe(300)
  })

  test('sums tokens across multiple blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'World' },
    ]
    expect(estimateMessageTokens(blocks)).toBe(
      estimateTokens('Hello') + estimateTokens('World')
    )
  })
})
