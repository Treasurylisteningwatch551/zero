import { describe, expect, test } from 'bun:test'
import { createFeishuStreamingStarter } from '../main'

function createStreamingSession(label: string) {
  return {
    messageId: label,
    update: async () => {},
    complete: async () => {},
    abort: async () => {},
  }
}

describe('createFeishuStreamingStarter', () => {
  test('uses replyStreaming for the initial message and later turns when reply target exists', async () => {
    const calls: Array<{ fn: 'reply' | 'send'; value: string }> = []
    const channel = {
      replyStreaming: async (messageId: string) => {
        calls.push({ fn: 'reply', value: messageId })
        return createStreamingSession(`reply:${messageId}`)
      },
      sendStreaming: async (chatId: string) => {
        calls.push({ fn: 'send', value: chatId })
        return createStreamingSession(`send:${chatId}`)
      },
    }

    const startStreaming = createFeishuStreamingStarter(channel, 'chat-1', 'msg-1')

    const first = await startStreaming()
    const second = await startStreaming()

    expect(first.messageId).toBe('reply:msg-1')
    expect(second.messageId).toBe('reply:msg-1')
    expect(calls).toEqual([
      { fn: 'reply', value: 'msg-1' },
      { fn: 'reply', value: 'msg-1' },
    ])
  })

  test('uses sendStreaming when no reply target exists', async () => {
    const calls: Array<{ fn: 'reply' | 'send'; value: string }> = []
    const channel = {
      replyStreaming: async (messageId: string) => {
        calls.push({ fn: 'reply', value: messageId })
        return createStreamingSession(`reply:${messageId}`)
      },
      sendStreaming: async (chatId: string) => {
        calls.push({ fn: 'send', value: chatId })
        return createStreamingSession(`send:${chatId}`)
      },
    }

    const startStreaming = createFeishuStreamingStarter(channel, 'chat-2')

    const first = await startStreaming()
    const second = await startStreaming()

    expect(first.messageId).toBe('send:chat-2')
    expect(second.messageId).toBe('send:chat-2')
    expect(calls).toEqual([
      { fn: 'send', value: 'chat-2' },
      { fn: 'send', value: 'chat-2' },
    ])
  })
})
