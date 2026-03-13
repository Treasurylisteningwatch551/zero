import { describe, expect, test } from 'bun:test'
import { OutputSecretFilter } from '../filter'

describe('OutputSecretFilter', () => {
  test('filters known secret values from text', () => {
    const filter = new OutputSecretFilter([
      ['api_key', 'sk-secret-12345'],
      ['token', 'ghp_abcdef123456'],
    ])

    const input = 'Using API key sk-secret-12345 to call the API'
    const output = filter.filter(input)
    expect(output).toBe('Using API key [REDACTED] to call the API')
    expect(output).not.toContain('sk-secret-12345')
  })

  test('filters multiple occurrences', () => {
    const filter = new OutputSecretFilter([['key', 'my-secret-value']])

    const input = 'key=my-secret-value, also key=my-secret-value'
    const output = filter.filter(input)
    expect(output).toBe('key=[REDACTED], also key=[REDACTED]')
  })

  test('filters base64-encoded secrets', () => {
    const secret = 'my-api-secret-key'
    const filter = new OutputSecretFilter([['key', secret]])

    const b64 = Buffer.from(secret).toString('base64')
    const input = `Encoded: ${b64}`
    const output = filter.filter(input)
    expect(output).not.toContain(b64)
    expect(output).toContain('[REDACTED]')
  })

  test('addSecret and removeSecret work dynamically', () => {
    const filter = new OutputSecretFilter()

    filter.addSecret('key', 'dynamic-secret')
    expect(filter.filter('value is dynamic-secret')).toBe('value is [REDACTED]')

    filter.removeSecret('key')
    expect(filter.filter('value is dynamic-secret')).toBe('value is dynamic-secret')
  })

  test('skips very short values to avoid false positives', () => {
    const filter = new OutputSecretFilter([['short', 'ab']])
    const input = 'ab is a common letter combo'
    expect(filter.filter(input)).toBe(input)
  })
})
