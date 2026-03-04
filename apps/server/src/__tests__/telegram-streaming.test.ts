import { describe, expect, test } from 'bun:test'
import { createTelegramStreamFlusher, reconcileTelegramFinalText } from '../telegram-streaming'

describe('telegram streaming flush controller', () => {
  test('forces a trailing flush after in-flight send completes', async () => {
    let text = 'chunk-1'
    const calls: string[] = []

    let releaseInitial: (() => void) | undefined
    const initialGate = new Promise<void>((resolve) => {
      releaseInitial = resolve
    })

    const flusher = createTelegramStreamFlusher({
      minIntervalMs: 350,
      now: () => 1_000,
      getText: () => text,
      sendInitial: async (payload) => {
        calls.push(`send:${payload}`)
        await initialGate
        return 9
      },
      edit: async (messageId, payload) => {
        calls.push(`edit:${messageId}:${payload}`)
      },
    })

    const firstFlush = flusher.flush(false)
    text = 'chunk-1-final'
    const forceFlush = flusher.flush(true)

    expect(calls).toEqual(['send:chunk-1'])

    releaseInitial?.()
    await Promise.all([firstFlush, forceFlush])

    expect(calls).toEqual(['send:chunk-1', 'edit:9:chunk-1-final'])
    expect(flusher.getLastFlushedText()).toBe('chunk-1-final')
  })

  test('keeps non-force cadence throttling', async () => {
    let nowMs = 1_000
    let text = 'hello'
    const calls: string[] = []

    const flusher = createTelegramStreamFlusher({
      minIntervalMs: 350,
      now: () => nowMs,
      getText: () => text,
      sendInitial: async (payload) => {
        calls.push(`send:${payload}`)
        return 7
      },
      edit: async (messageId, payload) => {
        calls.push(`edit:${messageId}:${payload}`)
      },
    })

    await flusher.flush(false)
    expect(calls).toEqual(['send:hello'])

    text = 'hello-2'
    nowMs = 1_100
    await flusher.flush(false)
    expect(calls).toEqual(['send:hello'])

    nowMs = 1_500
    await flusher.flush(false)
    expect(calls).toEqual(['send:hello', 'edit:7:hello-2'])
  })
})

describe('reconcileTelegramFinalText', () => {
  test('prefers final reply whenever content differs', () => {
    expect(reconcileTelegramFinalText('abcd', 'wxyz')).toBe('wxyz')
    expect(reconcileTelegramFinalText('prefix', 'final')).toBe('final')
  })

  test('keeps stream text when final reply is empty or identical', () => {
    expect(reconcileTelegramFinalText('same', 'same')).toBe('same')
    expect(reconcileTelegramFinalText('stream', '')).toBe('stream')
  })
})
