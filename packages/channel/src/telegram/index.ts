import { Telegraf } from 'telegraf'
import type { Channel, IncomingMessage, MessageHandler } from '../base'
import { chunkTelegramRichText, markdownToTelegramRichText, type TelegramRichText } from '../richtext'

export interface TelegramChannelConfig {
  botToken: string
}

interface TelegramSentMessage {
  message_id: number
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
          chatType: ctx.chat.type,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
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
    await this.sendRich(sessionId, content)
  }

  async reply(sessionId: string, messageId: number, content: string): Promise<void> {
    await this.replyRich(sessionId, messageId, content)
  }

  async sendRich(sessionId: string, content: string): Promise<TelegramSentMessage | null> {
    if (!this.bot) return null

    const chatId = this.parseChatId(sessionId)
    if (chatId === null) return null

    const rendered = markdownToTelegramRichText(content)
    return await this.sendRendered(chatId, rendered)
  }

  async replyRich(
    sessionId: string,
    messageId: number,
    content: string
  ): Promise<TelegramSentMessage | null> {
    if (!this.bot) return null

    const chatId = this.parseChatId(sessionId)
    if (chatId === null) return null

    const rendered = markdownToTelegramRichText(content)
    return await this.sendRendered(chatId, rendered, messageId)
  }

  async editRich(sessionId: string, messageId: number, content: string): Promise<void> {
    if (!this.bot) return

    const chatId = this.parseChatId(sessionId)
    if (chatId === null) return

    const rendered = markdownToTelegramRichText(content)
    const chunks = chunkTelegramRichText(rendered)
    if (chunks.length === 0) return

    const first = chunks[0]

    try {
      await this.bot.telegram.editMessageText(chatId, messageId, undefined, first.text || ' ', {
        entities: first.entities as any,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Ignore no-op edits during throttled streaming updates.
      if (!message.includes('message is not modified')) {
        throw err
      }
    }

    for (let i = 1; i < chunks.length; i++) {
      await this.bot.telegram.sendMessage(chatId, chunks[i].text || ' ', {
        entities: chunks[i].entities as any,
      })
    }
  }

  async sendTyping(sessionId: string): Promise<void> {
    if (!this.bot) return

    const chatId = this.parseChatId(sessionId)
    if (chatId === null) return

    await this.bot.telegram.sendChatAction(chatId, 'typing')
  }

  async react(sessionId: string, messageId: number, emoji = '👀'): Promise<void> {
    if (!this.bot) return

    const chatId = this.parseChatId(sessionId)
    if (chatId === null) return

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

  private parseChatId(sessionId: string): number | null {
    const chatId = Number(sessionId)
    return Number.isFinite(chatId) ? chatId : null
  }

  private async sendRendered(
    chatId: number,
    rendered: TelegramRichText,
    replyToMessageId?: number
  ): Promise<TelegramSentMessage | null> {
    if (!this.bot) return null

    const chunks = chunkTelegramRichText(rendered)
    if (chunks.length === 0) return null

    let firstMessage: TelegramSentMessage | null = null

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const sent = await this.bot.telegram.sendMessage(chatId, chunk.text || ' ', {
        entities: chunk.entities as any,
        ...(i === 0 && replyToMessageId
          ? {
              reply_parameters: {
                message_id: replyToMessageId,
              },
            }
          : {}),
      })

      if (!firstMessage) {
        firstMessage = sent as TelegramSentMessage
      }
    }

    return firstMessage
  }
}
