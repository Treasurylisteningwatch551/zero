import { describe, test, expect } from 'bun:test'
import { buildSnapshot } from '../snapshot'

describe('buildSnapshot', () => {
  test('returns an object with generated id starting with snap_', () => {
    const result = buildSnapshot({ sessionId: 'sess_1', trigger: 'manual' })
    expect(result.id).toMatch(/^snap_/)
  })

  test('includes all provided params', () => {
    const params = {
      sessionId: 'sess_abc',
      trigger: 'compression',
      systemPrompt: 'You are helpful.',
      tools: ['read', 'write'],
      parentSnapshot: 'snap_prev',
      identityMemory: 'user prefers dark mode',
      compressedSummary: 'prior conversation summary',
      messagesBefore: 20,
      messagesAfter: 8,
    }
    const result = buildSnapshot(params)
    expect(result.sessionId).toBe('sess_abc')
    expect(result.trigger).toBe('compression')
    expect(result.systemPrompt).toBe('You are helpful.')
    expect(result.tools).toEqual(['read', 'write'])
    expect(result.parentSnapshot).toBe('snap_prev')
    expect(result.identityMemory).toBe('user prefers dark mode')
    expect(result.compressedSummary).toBe('prior conversation summary')
    expect(result.messagesBefore).toBe(20)
    expect(result.messagesAfter).toBe(8)
  })

  test('omits ts field (added by logger)', () => {
    const result = buildSnapshot({ sessionId: 'sess_1', trigger: 'init' })
    expect(result).not.toHaveProperty('ts')
  })
})
