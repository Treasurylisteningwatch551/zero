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
    this.bot.catch((err, ctx) => {
      console.error('[TelegramChannel] Middleware error:', err, 'update_id:', ctx.update?.update_id)
    })

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

      // Fire-and-forget so long-running agent work does not block Telegraf update handling.
      this.messageHandler(incoming).catch((err) => {
        console.error('[TelegramChannel] Async text handler error:', err)
      })
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

      // Fire-and-forget so long-running agent work does not block Telegraf update handling.
      this.messageHandler(incoming).catch((err) => {
        console.error('[TelegramChannel] Async message handler error:', err)
      })
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

  async reply(sessionId: string, messageId: number, content: string): Promise<void> {
    if (!this.bot) return

    const chatId = Number(sessionId)
    if (isNaN(chatId)) return

    await this.bot.telegram.sendMessage(chatId, content, {
      parse_mode: 'Markdown',
      reply_parameters: {
        message_id: messageId,
      },
    })
  }

  async sendTyping(sessionId: string): Promise<void> {
    if (!this.bot) return

    const chatId = Number(sessionId)
    if (isNaN(chatId)) return

    await this.bot.telegram.sendChatAction(chatId, 'typing')
  }

  async react(sessionId: string, messageId: number, emoji = '👀'): Promise<void> {
    if (!this.bot) return

    const chatId = Number(sessionId)
    if (isNaN(chatId)) return

    await this.bot.telegram.setMessageReaction(
      chatId,
      messageId,
      [{ type: 'emoji', emoji } as any],
    )
  }

  isConnected(): boolean {
    return this.running
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler
  }
}
