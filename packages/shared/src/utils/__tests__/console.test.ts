import { describe, expect, test } from 'bun:test'
import { type TimestampConsoleTarget, installConsoleTimestampingOn } from '../console'

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error'

interface CapturedCall {
  method: ConsoleMethod
  args: unknown[]
}

const TIMESTAMP_PREFIX = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/

function createFakeConsole() {
  const calls: CapturedCall[] = []
  const target: TimestampConsoleTarget = {
    log: (...args: unknown[]) => calls.push({ method: 'log', args }),
    info: (...args: unknown[]) => calls.push({ method: 'info', args }),
    warn: (...args: unknown[]) => calls.push({ method: 'warn', args }),
    error: (...args: unknown[]) => calls.push({ method: 'error', args }),
  }

  return { calls, target }
}

describe('installConsoleTimestampingOn', () => {
  test('prefixes string logs with local timestamp', () => {
    const { calls, target } = createFakeConsole()

    installConsoleTimestampingOn(target)
    target.log('hello')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      method: 'log',
      args: [expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] hello$/)],
    })
  })

  test('keeps non-string trailing arguments intact', () => {
    const { calls, target } = createFakeConsole()
    const data = { code: 1 }

    installConsoleTimestampingOn(target)
    target.error('failed', data)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('error')
    expect(calls[0]?.args[0]).toEqual(
      expect.stringMatching(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] failed$/),
    )
    expect(calls[0]?.args[1]).toBe(data)
  })

  test('is idempotent when installed multiple times', () => {
    const { calls, target } = createFakeConsole()

    installConsoleTimestampingOn(target)
    installConsoleTimestampingOn(target)
    target.warn('once')

    expect(calls).toHaveLength(1)
    const message = calls[0]?.args[0]
    expect(typeof message).toBe('string')
    expect((message as string).match(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/g)).toHaveLength(1)
  })

  test('preserves leading newline before timestamp', () => {
    const { calls, target } = createFakeConsole()

    installConsoleTimestampingOn(target)
    target.log('\n[ZeRo OS] Shutting down...')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.args[0]).toEqual(
      expect.stringMatching(
        /^\n\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[ZeRo OS\] Shutting down\.\.\.$/,
      ),
    )
  })

  test('prefixes non-string first arguments without changing the object', () => {
    const { calls, target } = createFakeConsole()
    const error = new Error('boom')

    installConsoleTimestampingOn(target)
    target.error(error)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('error')
    expect(calls[0]?.args[0]).toEqual(expect.stringMatching(TIMESTAMP_PREFIX))
    expect(calls[0]?.args[1]).toBe(error)
  })
})
