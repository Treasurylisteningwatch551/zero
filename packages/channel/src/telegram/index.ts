import { Telegraf } from 'telegraf'
import type { Channel, IncomingMessage, MessageHandler } from '../base'

export interface TelegramChannelConfig {
  botToken: string
}

/**
 * Telegram channel — sends and receives messages via Telegram bot.
 */
export class TelegramChannel implements Channel {
  readonly name = 'telegram'
  readonly type = 'telegram'

  private bot: Telegraf | null = null
  private messageHandler: MessageHandler | null = null
  private running = false
  private config: TelegramChannelConfig

  constructor(config: TelegramChannelConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    this.bot = new Telegraf(this.config.botToken)

    // Handle text messages
    this.bot.on('text', async (ctx) => {
      if (!this.messageHandler) return

      const incoming: IncomingMessage = {
        channelType: 'telegram',
        senderId: String(ctx.from.id),
        content: ctx.message.text,
        timestamp: new Date(ctx.message.date * 1000).toISOString(),
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
          chatType: ctx.chat.type,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
        },
      }

      await this.messageHandler(incoming)
    })

    // Handle other message types
    this.bot.on('message', async (ctx) => {
      if (!this.messageHandler) return
      if ('text' in ctx.message) return // already handled above

      const incoming: IncomingMessage = {
        channelType: 'telegram',
        senderId: String(ctx.from.id),
        content: '[non-text message]',
        timestamp: new Date(ctx.message.date * 1000).toISOString(),
        metadata: {
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id,
        },
      }

      await this.messageHandler(incoming)
    })

    // Launch in polling mode (non-blocking)
    this.bot.launch()
    this.running = true
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop('ZeRo OS shutdown')
      this.running = false
      this.bot = null
    }
  }

  async send(sessionId: string, content: string): Promise<void> {
    if (!this.bot) return

    const chatId = Number(sessionId)
    if (isNaN(chatId)) return

    // Send with Markdown formatting
    await this.bot.telegram.sendMessage(chatId, content, {
      parse_mode: 'Markdown',
    })
  }

  isConnected(): boolean {
    return this.running
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler
  }
}
