import { describe, expect, test } from 'bun:test'
import { buildNewSessionReply } from '../main'

describe('buildNewSessionReply', () => {
  test('shows current model when /new is used without a model argument', () => {
    expect(buildNewSessionReply('openai-codex/gpt-5.4-medium')).toBe(
      'New conversation started with model: openai-codex/gpt-5.4-medium',
    )
  })

  test('shows current model when /new switches successfully', () => {
    expect(
      buildNewSessionReply('openai-codex/gpt-5.4-medium', {
        success: true,
        message: 'Model switched to openai-codex/gpt-5.4-medium',
      }),
    ).toBe('New conversation started with model: openai-codex/gpt-5.4-medium')
  })

  test('preserves failure messaging when model switch fails', () => {
    expect(
      buildNewSessionReply('openai-codex/gpt-5.3-codex-medium', {
        success: false,
        message: 'Unknown model: gpt-does-not-exist',
      }),
    ).toBe('New conversation started. Unknown model: gpt-does-not-exist')
  })
})
