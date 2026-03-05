import { describe, test, expect } from 'bun:test'
import { Readable } from 'node:stream'
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

  test('setMyCommands maps scope and language_code', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })
    const calls: any[] = []

    ;(channel as any).bot = {
      telegram: {
        setMyCommands: async (...args: any[]) => {
          calls.push(args)
          return true
        },
      },
    }

    await channel.setMyCommands(
      [{ command: 'restart', description: 'Restart service' }],
      {
        scope: {
          type: 'chat_member',
          chatId: 123,
          userId: 42,
        },
        languageCode: '',
      },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      [{ command: 'restart', description: 'Restart service' }],
      {
        scope: {
          type: 'chat_member',
          chat_id: 123,
          user_id: 42,
        },
        language_code: '',
      },
    ])
  })

  test('getMyCommands returns normalized commands', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })

    ;(channel as any).bot = {
      telegram: {
        getMyCommands: async () => ([
          { command: 'new', description: 'Start new chat', ignored: true },
          { command: 'model', description: 'Switch model' },
        ]),
      },
    }

    const commands = await channel.getMyCommands()
    expect(commands).toEqual([
      { command: 'new', description: 'Start new chat' },
      { command: 'model', description: 'Switch model' },
    ])
  })

  test('setChatMenuButton maps web_app url payload', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })
    const calls: any[] = []

    ;(channel as any).bot = {
      telegram: {
        setChatMenuButton: async (...args: any[]) => {
          calls.push(args)
          return true
        },
      },
    }

    await channel.setChatMenuButton({
      chatId: 123,
      menuButton: {
        type: 'web_app',
        text: 'Open',
        webAppUrl: 'https://example.com/app',
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([
      {
        chatId: 123,
        menuButton: {
          type: 'web_app',
          text: 'Open',
          web_app: {
            url: 'https://example.com/app',
          },
        },
      },
    ])
  })

  test('getChatMenuButton maps web_app response', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })

    ;(channel as any).bot = {
      telegram: {
        getChatMenuButton: async () => ({
          type: 'web_app',
          text: 'Open',
          web_app: {
            url: 'https://example.com/app',
          },
        }),
      },
    }

    const button = await channel.getChatMenuButton()
    expect(button).toEqual({
      type: 'web_app',
      text: 'Open',
      webAppUrl: 'https://example.com/app',
    })
  })

  test('message handler keeps caption and downloads highest-resolution photo', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })

    const requested: string[] = []
    ;(channel as any).bot = {
      telegram: {
        getFile: async (fileId: string) => {
          requested.push(fileId)
          return {
            file_id: fileId,
            file_path: 'photos/pic.jpg',
          }
        },
        getFileStream: async () => Readable.from([Buffer.from('img-binary')]),
      },
    }

    const msg = await (channel as any).buildIncomingMessage({
      from: { id: 1, username: 'u', first_name: 'n' },
      chat: { id: 123, type: 'private' },
      message: {
        date: 1,
        message_id: 10,
        caption: 'look',
        photo: [
          { file_id: 'small', width: 100, height: 80 },
          { file_id: 'large', width: 1200, height: 800 },
        ],
      },
    })

    expect(requested).toEqual(['large'])
    expect(msg.content).toBe('look')
    expect(msg.images?.length).toBe(1)
    expect(msg.images?.[0].mediaType).toBe('image/jpeg')
    expect(typeof msg.images?.[0].data).toBe('string')
  })

  test('message handler sets media hint for non-image media', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })

    ;(channel as any).bot = {
      telegram: {
        getFile: async () => ({ file_path: '' }),
        getFileStream: async () => Readable.from([]),
      },
    }

    const msg = await (channel as any).buildIncomingMessage({
      from: { id: 2, username: 'u2', first_name: 'n2' },
      chat: { id: 456, type: 'private' },
      message: {
        date: 2,
        message_id: 11,
        video: { file_id: 'v1' },
      },
    })

    expect(msg.content).toBe('[video]')
    expect(msg.images).toBeUndefined()
    expect(msg.metadata?.hasMedia).toBe(true)
  })

  test('extractImages supports image document mime type', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })

    ;(channel as any).bot = {
      telegram: {
        getFile: async () => ({ file_path: 'docs/pic.png' }),
        getFileStream: async () => Readable.from([Buffer.from('png-binary')]),
      },
    }

    const msg = await (channel as any).buildIncomingMessage({
      from: { id: 3 },
      chat: { id: 789, type: 'private' },
      message: {
        date: 3,
        message_id: 12,
        document: { file_id: 'doc1', mime_type: 'image/png' },
      },
    })

    expect(msg.images?.length).toBe(1)
    expect(msg.images?.[0].mediaType).toBe('image/png')
  })

  test('buildIncomingMessage is robust when from/chat/date are missing', async () => {
    const channel = new TelegramChannel({ botToken: 'test-token' })

    ;(channel as any).bot = {
      telegram: {
        getFile: async () => ({ file_path: '' }),
        getFileStream: async () => Readable.from([]),
      },
    }

    const msg = await (channel as any).buildIncomingMessage({
      message: {
        message_id: 13,
        caption: 'fallback',
      },
    })

    expect(msg.senderId).toBe('unknown')
    expect(msg.content).toBe('fallback')
    expect(typeof msg.timestamp).toBe('string')
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

  test('send uses interactive JSON 2.0 card first', async () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    const calls: any[] = []

    ;(channel as any).client = {
      im: {
        message: {
          create: async (payload: any) => {
            calls.push(payload)
          },
        },
      },
    }

    await channel.send('chat-1', 'hello')

    expect(calls).toHaveLength(1)
    expect(calls[0].params).toEqual({ receive_id_type: 'chat_id' })
    expect(calls[0].data.receive_id).toBe('chat-1')
    expect(calls[0].data.msg_type).toBe('interactive')
    expect(JSON.parse(calls[0].data.content)).toEqual({
      schema: '2.0',
      body: {
        direction: 'vertical',
        elements: [{ tag: 'markdown', content: 'hello' }],
      },
    })
  })

  test('send falls back to text when interactive and post sends fail', async () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    const calls: any[] = []

    ;(channel as any).client = {
      im: {
        message: {
          create: async (payload: any) => {
            calls.push(payload)
            if (payload?.data?.msg_type === 'interactive' || payload?.data?.msg_type === 'post') {
              throw new Error('rich failed')
            }
          },
        },
      },
    }

    await channel.send('chat-2', 'fallback')

    expect(calls).toHaveLength(3)
    expect(calls[0].data.msg_type).toBe('interactive')
    expect(calls[1].data.msg_type).toBe('post')
    expect(calls[2].data.msg_type).toBe('text')
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
    expect(calls[0].path).toEqual({ message_id: 'msg-1' })
    expect(calls[0].data.msg_type).toBe('interactive')
    expect(JSON.parse(calls[0].data.content)).toEqual({
      schema: '2.0',
      body: {
        direction: 'vertical',
        elements: [{ tag: 'markdown', content: 'hello' }],
      },
    })
  })

  test('reply falls back to post when interactive reply fails', async () => {
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
        content: JSON.stringify({
          zh_cn: {
            content: [[{ tag: 'md', text: 'fallback' }]],
          },
        }),
        msg_type: 'post',
      },
    })
  })

  test('reply falls back to text when interactive and post replies fail', async () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    const calls: any[] = []

    ;(channel as any).client = {
      im: {
        message: {
          reply: async (payload: any) => {
            calls.push(payload)
            if (payload?.data?.msg_type === 'interactive' || payload?.data?.msg_type === 'post') {
              throw new Error('interactive failed')
            }
          },
        },
      },
    }

    await channel.reply('msg-3', 'fail-all')
    expect(calls).toHaveLength(3)
    expect(calls[0].data.msg_type).toBe('interactive')
    expect(calls[1].data.msg_type).toBe('post')
    expect(calls[2].data.msg_type).toBe('text')
  })

  test('reply throws when interactive, post and text replies all fail', async () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    const calls: any[] = []

    ;(channel as any).client = {
      im: {
        message: {
          reply: async (payload: any) => {
            calls.push(payload)
            if (payload?.data?.msg_type === 'text') {
              throw new Error('text failed')
            }
            throw new Error('rich failed')
          },
        },
      },
    }

    await expect(channel.reply('msg-4', 'fail-all')).rejects.toThrow('text failed')
    expect(calls).toHaveLength(3)
    expect(calls[0].data.msg_type).toBe('interactive')
    expect(calls[1].data.msg_type).toBe('post')
    expect(calls[2].data.msg_type).toBe('text')
  })

  test('reply returns early when client is null', async () => {
    const channel = new FeishuChannel({ appId: 'test-id', appSecret: 'test-secret' })
    await expect(channel.reply('msg-5', 'no-client')).resolves.toBeUndefined()
  })
})
