import { describe, expect, test } from 'bun:test'
import { generateId, generatePrefixedId, generateSessionId } from '../id'

describe('ID generation', () => {
  test('generateId returns a valid UUIDv7', () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('generateId produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })

  test('generatePrefixedId has the correct prefix', () => {
    const id = generatePrefixedId('req')
    expect(id).toMatch(/^req_/)
    expect(id.length).toBeGreaterThan(4)
  })

  test('generateSessionId has date-based format', () => {
    const id = generateSessionId()
    expect(id).toMatch(/^sess_\d{8}_[0-9a-f]{8}$/)
  })
})
