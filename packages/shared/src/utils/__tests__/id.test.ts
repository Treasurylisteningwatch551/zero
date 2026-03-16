import { describe, expect, test } from 'bun:test'
import {
  buildSessionId,
  formatLocalSessionDateParts,
  generateId,
  generatePrefixedId,
  generateSessionId,
  getSessionLogRelativeDir,
  parseSessionId,
  sessionSourceToAbbreviation,
} from '../id'

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

  test('generateSessionId has local date, time, and source format', () => {
    const id = generateSessionId('feishu')
    expect(id).toMatch(/^sess_\d{8}_\d{4}_fei_[0-9a-f]{4}$/)
  })

  test('formatLocalSessionDateParts uses local clock fields', () => {
    const date = new Date('2026-03-13T02:05:00.000Z')
    const parts = formatLocalSessionDateParts(date)

    expect(parts.dateStamp).toBe(
      `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`,
    )
    expect(parts.timeStamp).toBe(
      `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`,
    )
  })

  test('buildSessionId accepts explicit source code and date', () => {
    const date = new Date('2026-03-13T10:23:00.000Z')
    const id = buildSessionId('web', date, 'a1b2')
    const parsed = parseSessionId(id)
    const parts = formatLocalSessionDateParts(date)

    expect(parsed).toEqual({
      layout: 'dated',
      dateStamp: parts.dateStamp,
      timeStamp: parts.timeStamp,
      sourceCode: 'web',
      random: 'a1b2',
    })
  })

  test('sessionSourceToAbbreviation maps runtime sources to stable codes', () => {
    expect(sessionSourceToAbbreviation('web')).toBe('web')
    expect(sessionSourceToAbbreviation('feishu')).toBe('fei')
    expect(sessionSourceToAbbreviation('telegram')).toBe('tel')
    expect(sessionSourceToAbbreviation('scheduler')).toBe('sch')
    expect(sessionSourceToAbbreviation('browser')).toBe('brw')
  })

  test('getSessionLogRelativeDir resolves the dated session path', () => {
    expect(getSessionLogRelativeDir('sess_20260313_1423_fei_a1b2')).toBe(
      'sessions/2026-03-13/sess_20260313_1423_fei_a1b2',
    )
    expect(getSessionLogRelativeDir('sess_test')).toBe('sessions/sess_test')
  })
})
