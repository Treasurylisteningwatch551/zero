import * as lark from '@larksuiteoapi/node-sdk'
import type { Channel, IncomingMessage, MessageHandler } from '../base'

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
  private messageHandler: MessageHandler | null = null
  private connected = false
  private config: FeishuChannelConfig

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
        if (!this.messageHandler) return

        const msg = data?.message
        if (!msg) return

        // Only handle text messages
        let content = ''
        if (msg.message_type === 'text') {
          const parsed = JSON.parse(msg.content ?? '{}')
          content = parsed.text ?? ''
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
        }

        await this.messageHandler(incoming)
      },
    })

    this.connected = true
  }

  async stop(): Promise<void> {
    this.connected = false
    this.client = null
    this.eventDispatcher = null
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
   * Get the Lark EventDispatcher for mounting as webhook endpoint.
   */
  getEventDispatcher(): lark.EventDispatcher | null {
    return this.eventDispatcher
  }
}
