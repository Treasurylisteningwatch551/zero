import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { UserMessageBlock } from '../UserMessageBlock'

describe('UserMessageBlock', () => {
  test('renders a queued badge when the message was queued during execution', () => {
    const html = renderToStaticMarkup(
      <UserMessageBlock
        text="可以使用 qwen image 这个来生成图片"
        queued
        createdAt="2026-03-17T03:27:00.000Z"
      />,
    )

    expect(html).toContain('Queued')
    expect(html).toContain('可以使用 qwen image 这个来生成图片')
  })

  test('renders queued image attachments without exposing placeholder text', () => {
    const html = renderToStaticMarkup(
      <UserMessageBlock
        text="设计草图"
        queued
        images={[{ mediaType: 'image/png', data: 'abc123' }]}
        createdAt="2026-03-17T03:27:00.000Z"
      />,
    )

    expect(html).toContain('data:image/png;base64,abc123')
    expect(html).toContain('设计草图')
  })
})
