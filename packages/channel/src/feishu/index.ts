import * as lark from '@larksuiteoapi/node-sdk'
import type { Channel, IncomingMessage, ImageAttachment, MessageHandler } from '../base'

export interface FeishuChannelConfig {
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
}

/**
 * Feishu (Lark) channel — sends and receives messages via Feishu bot.
 */
export class FeishuChannel implements Channel {
  readonly name = 'feishu'
  readonly type = 'feishu'

  private client: lark.Client | null = null
  private eventDispatcher: lark.EventDispatcher | null = null
  private wsClient: lark.WSClient | null = null
  private messageHandler: MessageHandler | null = null
  private connected = false
  private config: FeishuChannelConfig
  private processedMessageIds: Set<string> = new Set()

  constructor(config: FeishuChannelConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    this.client = new lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    })

    this.eventDispatcher = new lark.EventDispatcher({
      encryptKey: this.config.encryptKey ?? '',
      verificationToken: this.config.verificationToken ?? '',
    })

    // Listen for incoming messages
    this.eventDispatcher.register({
      'im.message.receive_v1': async (data: any) => {
        try {
          if (!this.messageHandler) return

          const msg = data?.message
          if (!msg) {
            console.warn('[FeishuChannel] Received event with no message payload')
            return
          }

          // Dedup: skip if this message_id was already processed
          const messageId = msg.message_id
          if (messageId && this.processedMessageIds.has(messageId)) {
            console.log('[FeishuChannel] Skipping duplicate message:', messageId)
            return
          }
          if (messageId) {
            this.processedMessageIds.add(messageId)
            // Prevent unbounded growth — trim oldest entry when exceeding 1000
            if (this.processedMessageIds.size > 1000) {
              const first = this.processedMessageIds.values().next().value!
              this.processedMessageIds.delete(first)
            }
          }

          console.log('[FeishuChannel] im.message.receive_v1 from', data.sender?.sender_id?.open_id ?? 'unknown')

          let content = ''
          const images: ImageAttachment[] = []
          if (msg.message_type === 'text') {
            try {
              const parsed = JSON.parse(msg.content ?? '{}')
              content = parsed.text ?? ''
            } catch (parseErr) {
              console.error('[FeishuChannel] Failed to parse message content:', parseErr)
              content = msg.content ?? ''
            }
          } else if (msg.message_type === 'post') {
            try {
              const parsed = JSON.parse(msg.content ?? '{}')
              // post content is keyed by locale (zh_cn, en_us, etc.), pick first available
              const locale = parsed.zh_cn ?? parsed.en_us ?? Object.values(parsed)[0] as any
              if (locale?.content) {
                const parts: string[] = []
                if (locale.title) parts.push(`# ${locale.title}`)
                for (const paragraph of locale.content) {
                  const lineParts: string[] = []
                  for (const el of paragraph as any[]) {
                    switch (el.tag) {
                      case 'text': {
                        let t = el.text ?? ''
                        const s = el.style as string[] | undefined
                        if (s?.includes('bold')) t = `**${t}**`
                        if (s?.includes('italic')) t = `*${t}*`
                        if (s?.includes('lineThrough')) t = `~~${t}~~`
                        if (s?.includes('underline')) t = `<u>${t}</u>`
                        lineParts.push(t)
                        break
                      }
                      case 'a':
                        lineParts.push(el.href ? `[${el.text ?? ''}](${el.href})` : el.text ?? '')
                        break
                      case 'img':
                        if (el.image_key && this.client) {
                          try {
                            const imgResp = await this.client.im.image.get({
                              path: { image_key: el.image_key },
                              params: { image_type: 'message' },
                            })
                            const buf = Buffer.from(imgResp as ArrayBuffer)
                            images.push({ mediaType: 'image/png', data: buf.toString('base64') })
                            lineParts.push('[图片]')
                          } catch (imgErr) {
                            console.error('[FeishuChannel] Failed to download image:', el.image_key, imgErr)
                            lineParts.push('[图片]')
                          }
                        }
                        break
                      case 'at':
                        lineParts.push(`@${el.user_name ?? el.user_id ?? 'user'}`)
                        break
                    }
                  }
                  parts.push(lineParts.join(''))
                }
                content = parts.join('\n\n')
              }
            } catch (parseErr) {
              console.error('[FeishuChannel] Failed to parse post content:', parseErr)
              content = msg.content ?? ''
            }
          } else if (msg.message_type === 'image') {
            // Standalone image message
            try {
              const parsed = JSON.parse(msg.content ?? '{}')
              if (parsed.image_key && this.client) {
                const imgResp = await this.client.im.image.get({
                  path: { image_key: parsed.image_key },
                  params: { image_type: 'message' },
                })
                const buf = Buffer.from(imgResp as ArrayBuffer)
                images.push({ mediaType: 'image/png', data: buf.toString('base64') })
                content = '[图片]'
              }
            } catch (imgErr) {
              console.error('[FeishuChannel] Failed to download image message:', imgErr)
              content = '[图片]'
            }
          } else {
            content = `[${msg.message_type} message]`
          }

          const incoming: IncomingMessage = {
            channelType: 'feishu',
            senderId: data.sender?.sender_id?.open_id ?? 'unknown',
            content,
            timestamp: new Date(Number(msg.create_time) * 1000).toISOString(),
            metadata: {
              chatId: msg.chat_id,
              messageId: msg.message_id,
              chatType: msg.chat_type,
            },
            images: images.length > 0 ? images : undefined,
          }

          // Add typing reaction immediately (fire-and-forget, don't block ACK)
          if (this.client && messageId) {
            this.client.im.messageReaction.create({
              path: { message_id: messageId },
              data: { reaction_type: { emoji_type: 'Typing' } },
            }).catch(() => {})
          }

          // Fire-and-forget: return immediately so SDK sends ACK within 3s
          this.messageHandler(incoming).catch((err) => {
            console.error('[FeishuChannel] Async handler error:', err)
          })
        } catch (err) {
          console.error('[FeishuChannel] Error handling im.message.receive_v1:', err)
        }
      },
    })

    // Use WebSocket long connection for event delivery (no webhook/ngrok needed)
    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: lark.LoggerLevel.info,
    })
    await this.wsClient.start({ eventDispatcher: this.eventDispatcher })
    console.log('[FeishuChannel] WSClient connected')

    this.connected = true
  }

  async stop(): Promise<void> {
    this.wsClient?.close()
    this.wsClient = null
    this.connected = false
    this.client = null
    this.eventDispatcher = null
    this.processedMessageIds.clear()
  }

  async send(sessionId: string, content: string): Promise<void> {
    if (!this.client) return

    // Send as interactive card for rich notifications, or text for simple replies
    const isNotification = content.startsWith('[notification]')
    const cleanContent = isNotification ? content.replace('[notification]', '').trim() : content

    if (isNotification) {
      // Send as Feishu interactive card
      await this.client.im.message.create({
        data: {
          receive_id: sessionId,
          msg_type: 'interactive',
          content: JSON.stringify({
            config: { wide_screen_mode: true },
            header: {
              title: { tag: 'plain_text', content: 'ZeRo OS Notification' },
              template: 'orange',
            },
            elements: [
              { tag: 'markdown', content: cleanContent },
            ],
          }),
        },
        params: { receive_id_type: 'chat_id' },
      })
    } else {
      // Send as plain text
      await this.client.im.message.create({
        data: {
          receive_id: sessionId,
          msg_type: 'text',
          content: JSON.stringify({ text: cleanContent }),
        },
        params: { receive_id_type: 'chat_id' },
      })
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  /**
   * Reply to a specific message (quote-reply).
   */
  async reply(messageId: string, content: string): Promise<void> {
    if (!this.client) return
    await this.client.im.message.reply({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify({ text: content }),
        msg_type: 'text',
      },
    })
  }
}
