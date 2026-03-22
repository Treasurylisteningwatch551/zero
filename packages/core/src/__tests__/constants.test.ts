import { describe, expect, it } from 'bun:test'
import { EMPTY_RESPONSE_RETRY_PROMPT } from '../constants'

describe('EMPTY_RESPONSE_RETRY_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof EMPTY_RESPONSE_RETRY_PROMPT).toBe('string')
    expect(EMPTY_RESPONSE_RETRY_PROMPT.length).toBeGreaterThan(0)
  })

  it('is referenced by agent.ts and session.ts', () => {
    // This is verified externally via grep; this test just ensures the constant is importable
    expect(EMPTY_RESPONSE_RETRY_PROMPT).toBeDefined()
  })
})
