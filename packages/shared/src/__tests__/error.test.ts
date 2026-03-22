import { describe, expect, it } from 'bun:test'

import { describeError, toErrorMessage } from '../utils/error'

describe('toErrorMessage', () => {
  it('returns error.message for Error instances', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns string values as-is', () => {
    expect(toErrorMessage('plain string')).toBe('plain string')
  })

  it('stringifies numbers', () => {
    expect(toErrorMessage(42)).toBe('42')
  })

  it('stringifies booleans', () => {
    expect(toErrorMessage(true)).toBe('true')
  })

  it('stringifies null', () => {
    expect(toErrorMessage(null)).toBe('null')
  })

  it('stringifies undefined', () => {
    expect(toErrorMessage(undefined)).toBe('undefined')
  })

  it('stringifies plain objects with String()', () => {
    expect(toErrorMessage({ foo: 'bar' })).toBe('[object Object]')
  })
})

describe('describeError', () => {
  it('returns error.message for Error instances', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
  })

  it('returns string values as-is', () => {
    expect(describeError('plain string')).toBe('plain string')
  })

  it('stringifies numbers', () => {
    expect(describeError(42)).toBe('42')
  })

  it('stringifies booleans', () => {
    expect(describeError(true)).toBe('true')
  })

  it('stringifies null', () => {
    expect(describeError(null)).toBe('null')
  })

  it('stringifies undefined', () => {
    expect(describeError(undefined)).toBe('undefined')
  })

  it('includes response.status and message', () => {
    const result = describeError({
      response: { status: 404 },
      message: 'Not Found',
    })

    expect(result).toContain('status=404')
    expect(result).toContain('Not Found')
  })

  it('includes uppercase method and url from config', () => {
    expect(
      describeError({
        config: {
          method: 'post',
          url: 'https://example.com/items',
        },
      }),
    ).toBe('POST https://example.com/items')
  })

  it('returns the message when only a message property is present', () => {
    expect(describeError({ message: 'just a message' })).toBe('just a message')
  })

  it('includes code and message', () => {
    expect(
      describeError({
        code: 'ECONNREFUSED',
        message: 'connect failed',
      }),
    ).toBe('code=ECONNREFUSED | connect failed')
  })

  it('uses statusCode when response.status and status are absent', () => {
    expect(describeError({ statusCode: 502 })).toBe('status=502')
  })

  it('includes request id from response headers', () => {
    expect(
      describeError({
        response: {
          headers: {
            'x-request-id': 'req-123',
          },
        },
      }),
    ).toBe('request_id=req-123')
  })

  it('includes response.data code and msg detail', () => {
    expect(
      describeError({
        response: {
          data: {
            code: 99991663,
            msg: 'rate limited',
          },
        },
      }),
    ).toBe('detail=code=99991663 rate limited')
  })

  it('combines all supported fields in the expected order', () => {
    expect(
      describeError({
        code: 'E_UPSTREAM',
        message: 'gateway failed',
        config: {
          method: 'post',
          url: 'https://example.com/api',
        },
        response: {
          status: 503,
          headers: {
            'x-request-id': 'req-789',
          },
          data: {
            code: 1001,
            msg: 'service unavailable',
          },
        },
      }),
    ).toBe(
      'status=503 | code=E_UPSTREAM | request_id=req-789 | POST https://example.com/api | gateway failed | detail=code=1001 service unavailable',
    )
  })

  it('returns [unknown error] for empty objects', () => {
    expect(describeError({})).toBe('[unknown error]')
  })

  it('prefers response.status over record.status', () => {
    const result = describeError({
      status: 500,
      response: { status: 404 },
    })

    expect(result).toContain('status=404')
    expect(result).not.toContain('status=500')
  })

  it('uses record-level url when config.url is absent', () => {
    expect(
      describeError({
        url: 'https://example.com/fallback',
      }),
    ).toBe('REQUEST https://example.com/fallback')
  })

  it('shows an uppercase method without a trailing space when config.url is absent', () => {
    expect(
      describeError({
        config: {
          method: 'patch',
        },
      }),
    ).toBe('PATCH')
  })

  it('truncates string response.data detail', () => {
    const detail = 'x'.repeat(200)

    expect(
      describeError({
        response: {
          data: detail,
        },
      }),
    ).toBe(`detail=${'x'.repeat(157)}...`)
  })
})
