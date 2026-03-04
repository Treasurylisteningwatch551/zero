import { describe, test, expect } from 'bun:test'
import { TelegramChannel } from '../telegram/index'
import { FeishuChannel } from '../feishu/index'

describe('TelegramChannel contract', () => {
  test('name is telegram and type is telegram', () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })
    expect(channel.name).toBe('telegram')
    expect(channel.type).toBe('telegram')
  })

  test('initial isConnected is false', () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })
    expect(channel.isConnected()).toBe(false)
  })

  test('reply sends message with reply_parameters', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })
    const calls: any[] = []

    ;(channel as any).bot = {
      telegram: {
        sendMessage: async (...args: any[]) => {
          calls.push(args)
        },
      },
    }

    await channel.reply('123', 456, '👀')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      123,
      '👀',
      {
        entities: [],
        reply_parameters: {
          message_id: 456,
        },
      },
    ])
  })

  test('editRich edits existing message with entities', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })
    const calls: any[] = []

    ;(channel as any).bot = {
      telegram: {
        editMessageText: async (...args: any[]) => {
          calls.push(args)
          return true
        },
      },
    }

    await channel.editRich('123', 9, '**bold**')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      123,
      9,
      undefined,
      'bold',
      {
        entities: [{ type: 'bold', offset: 0, length: 4 }],
      },
    ])
  })

  test('sendTyping sends typing chat action', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })
    const calls: any[] = []

    ;(channel as any).bot = {
      telegram: {
        sendChatAction: async (...args: any[]) => {
          calls.push(args)
          return true
        },
      },
    }

    await channel.sendTyping('123')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([123, 'typing'])
  })

  test('react sends message reaction', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })
    const calls: any[] = []

    ;(channel as any).bot = {
      telegram: {
        setMessageReaction: async (...args: any[]) => {
          calls.push(args)
          return true
        },
      },
    }

    await channel.react('123', 456, '👀')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      123,
      456,
      [{ type: 'emoji', emoji: '👀' }],
    ])
  })
})

describe('FeishuChannel contract', () => {
  test('name is feishu and type is feishu', () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    expect(channel.name).toBe('feishu')
    expect(channel.type).toBe('feishu')
  })

  test('initial isConnected is false', () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    expect(channel.isConnected()).toBe(false)
  })

  test('reply sends interactive markdown first', async () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    const calls: any[] = []

    ;(channel as any).client = {
      im: {
        message: {
          reply: async (payload: any) => {
            calls.push(payload)
          },
        },
      },
    }

    await channel.reply('msg-1', 'hello')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      path: { message_id: 'msg-1' },
      data: {
        content: JSON.stringify({
          elements: [
            { tag: 'markdown', content: 'hello' },
          ],
        }),
        msg_type: 'interactive',
      },
    })
  })

  test('reply falls back to text when interactive reply fails', async () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    const calls: any[] = []

    ;(channel as any).client = {
      im: {
        message: {
          reply: async (payload: any) => {
            calls.push(payload)
            if (payload?.data?.msg_type === 'interactive') {
              throw new Error('interactive failed')
            }
          },
        },
      },
    }

    await channel.reply('msg-2', 'fallback')

    expect(calls).toHaveLength(2)
    expect(calls[0].data.msg_type).toBe('interactive')
    expect(calls[1]).toEqual({
      path: { message_id: 'msg-2' },
      data: {
        content: JSON.stringify({ text: 'fallback' }),
        msg_type: 'text',
      },
    })
  })

  test('reply throws when both interactive and text replies fail', async () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    const calls: any[] = []

    ;(channel as any).client = {
      im: {
        message: {
          reply: async (payload: any) => {
            calls.push(payload)
            if (payload?.data?.msg_type === 'interactive') {
              throw new Error('interactive failed')
            }
            throw new Error('text failed')
          },
        },
      },
    }

    await expect(channel.reply('msg-3', 'fail-all')).rejects.toThrow('text failed')
    expect(calls).toHaveLength(2)
    expect(calls[0].data.msg_type).toBe('interactive')
    expect(calls[1].data.msg_type).toBe('text')
  })

  test('reply returns early when client is null', async () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    await expect(channel.reply('msg-4', 'no-client')).resolves.toBeUndefined()
  })
})
