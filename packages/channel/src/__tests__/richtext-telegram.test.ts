import { describe, expect, test } from 'bun:test'
import { chunkTelegramRichText, markdownToTelegramRichText } from '../richtext'

describe('Telegram richtext renderer', () => {
  test('renders inline markdown to entities', () => {
    const rendered = markdownToTelegramRichText(
      '**Bold** and _italic_ with [link](https://example.com)',
    )

    expect(rendered.text).toBe('Bold and italic with link')
    expect(rendered.entities).toEqual([
      { type: 'bold', offset: 0, length: 4 },
      { type: 'italic', offset: 9, length: 6 },
      { type: 'text_link', offset: 21, length: 4, url: 'https://example.com' },
    ])
  })

  test('renders fenced code block as pre entity', () => {
    const rendered = markdownToTelegramRichText('```ts\nconst x = 1\n```')

    expect(rendered.text).toBe('const x = 1\n')
    expect(rendered.entities).toEqual([{ type: 'pre', offset: 0, length: 12, language: 'ts' }])
  })

  test('renders blockquote markers', () => {
    const rendered = markdownToTelegramRichText('> quoted\n>! expandable')

    expect(rendered.text).toBe('quoted\nexpandable')
    expect(rendered.entities).toEqual([
      { type: 'blockquote', offset: 0, length: 6 },
      { type: 'expandable_blockquote', offset: 7, length: 10 },
    ])
  })

  test('renders headings as bold and normalizes list markers', () => {
    const rendered = markdownToTelegramRichText('## Title\n- item\n- [x] done\n1. step')

    expect(rendered.text).toBe('Title\n• item\n☑ done\n1. step')
    expect(rendered.entities).toEqual([{ type: 'bold', offset: 0, length: 5 }])
  })

  test('chunks long messages and remaps entity offsets', () => {
    const long = `${'a'.repeat(4100)}**ok**`
    const rendered = markdownToTelegramRichText(long)
    const chunks = chunkTelegramRichText(rendered, 4096)

    expect(chunks.length).toBeGreaterThan(1)
    const last = chunks[chunks.length - 1]
    expect(last.text.endsWith('ok')).toBe(true)
    expect(last.entities[last.entities.length - 1]).toEqual({ type: 'bold', offset: 4, length: 2 })
  })
})
