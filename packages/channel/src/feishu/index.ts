import * as lark from '@larksuiteoapi/node-sdk'
import type { Channel, IncomingMessage, ImageAttachment, MessageHandler } from '../base'
import { renderMarkdownForFeishu } from '../richtext/feishu'

export interface FeishuChannelConfig {
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
}

interface FeishuCardOptions {
  title?: string
  template?: string
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
  private static readonly MAX_TEXT_MESSAGE_BYTES = 150 * 1024
  private static readonly MAX_RICH_MESSAGE_BYTES = 30 * 1024

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
              // parsePostContent collects image_keys as { mediaType: '__pending__', data: image_key }
              const pendingImages: ImageAttachment[] = []
              content = this.parsePostContent(parsed, pendingImages)
              // Download pending images via messageResource API (post images need message_id)
              if (this.client && messageId) {
                const downloads = pendingImages
                  .filter(p => p.mediaType === '__pending__')
                  .map(async (p) => {
                    try {
                      const resp = await this.client!.im.messageResource.get({
                        path: { message_id: messageId, file_key: p.data },
                        params: { type: 'image' },
                      })
                      const stream = resp.getReadableStream()
                      const chunks: Buffer[] = []
                      for await (const chunk of stream) {
                        chunks.push(Buffer.from(chunk))
                      }
                      const buf = Buffer.concat(chunks)
                      images.push({ mediaType: 'image/png', data: buf.toString('base64') })
                    } catch (imgErr: any) {
                      console.error('[FeishuChannel] Failed to download image:', p.data,
                        `HTTP ${imgErr?.response?.status ?? '?'}:`, imgErr?.message ?? imgErr)
                    }
                  })
                await Promise.all(downloads)
              }
            } catch (parseErr) {
              console.error('[FeishuChannel] Failed to parse post content:', parseErr, 'raw:', msg.content)
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
            } catch (imgErr: any) {
              console.error('[FeishuChannel] Failed to download image message:',
                `HTTP ${imgErr?.response?.status ?? '?'}:`, imgErr?.message ?? imgErr)
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

    const rendered = renderMarkdownForFeishu(content)
    const isNotification = content.startsWith('[notification]')
    const cleanContent = isNotification ? rendered.replace('[notification]', '').trim() : rendered
    const options = isNotification
      ? { title: 'ZeRo OS Notification', template: 'orange' }
      : undefined
    const chunks = this.chunkRichContent(cleanContent, options)

    for (let i = 0; i < chunks.length; i++) {
      const chunkOptions = i === 0 ? options : undefined
      await this.sendCreateWithFallback(sessionId, chunks[i], chunkOptions)
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
    const rendered = renderMarkdownForFeishu(content)
    const chunks = this.chunkRichContent(rendered)
    for (const chunk of chunks) {
      await this.sendReplyWithFallback(messageId, chunk)
    }
  }

  /** Build JSON 2.0 interactive card payload. */
  private buildMarkdownCardV2(content: string, options?: FeishuCardOptions): string {
    const card: Record<string, unknown> = {
      schema: '2.0',
      body: {
        direction: 'vertical',
        elements: [{ tag: 'markdown', content }],
      },
    }

    if (options?.title) {
      card.header = {
        title: { tag: 'plain_text', content: options.title },
        ...(options.template ? { template: options.template } : {}),
      }
    }

    return JSON.stringify(card)
  }

  /** Build post payload with md tag for fallback. */
  private buildPostContent(content: string, options?: FeishuCardOptions): string {
    const zhCn: Record<string, unknown> = {
      content: [[{ tag: 'md', text: content }]],
    }
    if (options?.title) {
      zhCn.title = options.title
    }
    return JSON.stringify({ zh_cn: zhCn })
  }

  /** Build text payload as last fallback. */
  private buildTextContent(content: string, options?: FeishuCardOptions): string {
    if (!options?.title) {
      return JSON.stringify({ text: content })
    }

    const text = content ? `${options.title}\n\n${content}` : options.title
    return JSON.stringify({ text })
  }

  /**
   * Split message by line with byte-size guard for rich payloads.
   * This avoids hitting Feishu's 30KB post/interactive limit.
   */
  private chunkRichContent(content: string, options?: FeishuCardOptions): string[] {
    const chunks = this.splitByLinePreserveLimit(
      content,
      FeishuChannel.MAX_RICH_MESSAGE_BYTES,
      (chunk) => this.buildMarkdownCardV2(chunk),
    )

    if (options?.title && chunks.length > 0) {
      const firstPayload = this.buildMarkdownCardV2(chunks[0], options)
      if (this.byteLength(firstPayload) > FeishuChannel.MAX_RICH_MESSAGE_BYTES) {
        const firstChunks = this.splitByLinePreserveLimit(
          chunks[0],
          FeishuChannel.MAX_RICH_MESSAGE_BYTES,
          (chunk) => this.buildMarkdownCardV2(chunk, options),
        )
        chunks.splice(0, 1, ...firstChunks)
      }
    }

    return chunks
  }

  private splitByLinePreserveLimit(
    content: string,
    maxBytes: number,
    payloadBuilder: (chunk: string) => string
  ): string[] {
    if (this.byteLength(payloadBuilder(content)) <= maxBytes) {
      return [content]
    }

    const lines = content.split('\n')
    const chunks: string[] = []
    let current = ''

    for (const line of lines) {
      const candidate = current ? `${current}\n${line}` : line
      if (current && this.byteLength(payloadBuilder(candidate)) > maxBytes) {
        chunks.push(current)
        current = ''
      }

      if (this.byteLength(payloadBuilder(line)) <= maxBytes) {
        current = current ? `${current}\n${line}` : line
        continue
      }

      if (current) {
        chunks.push(current)
        current = ''
      }

      let remaining = line
      while (remaining.length > 0) {
        const prefix = this.takeLargestPrefix(remaining, maxBytes, payloadBuilder)
        if (!prefix) {
          chunks.push(remaining)
          remaining = ''
          continue
        }
        chunks.push(prefix)
        remaining = remaining.slice(prefix.length)
      }
    }

    if (current) {
      chunks.push(current)
    }

    return chunks.length > 0 ? chunks : [content]
  }

  private takeLargestPrefix(
    content: string,
    maxBytes: number,
    payloadBuilder: (chunk: string) => string
  ): string {
    let lo = 1
    let hi = content.length
    let best = 0

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      const sample = content.slice(0, mid)
      if (this.byteLength(payloadBuilder(sample)) <= maxBytes) {
        best = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }

    return best > 0 ? content.slice(0, best) : ''
  }

  private byteLength(value: string): number {
    return Buffer.byteLength(value, 'utf8')
  }

  private async sendCreateWithFallback(
    sessionId: string,
    content: string,
    options?: FeishuCardOptions
  ): Promise<void> {
    if (!this.client) return

    const interactiveContent = this.buildMarkdownCardV2(content, options)
    if (this.byteLength(interactiveContent) <= FeishuChannel.MAX_RICH_MESSAGE_BYTES) {
      try {
        await this.client.im.message.create({
          data: {
            receive_id: sessionId,
            msg_type: 'interactive',
            content: interactiveContent,
          },
          params: { receive_id_type: 'chat_id' },
        })
        return
      } catch (interactiveErr) {
        console.warn('[FeishuChannel] interactive send failed, fallback to post:', interactiveErr)
      }
    } else {
      console.warn('[FeishuChannel] interactive payload exceeds size limit, fallback to post')
    }

    const postContent = this.buildPostContent(content, options)
    if (this.byteLength(postContent) <= FeishuChannel.MAX_RICH_MESSAGE_BYTES) {
      try {
        await this.client.im.message.create({
          data: {
            receive_id: sessionId,
            msg_type: 'post',
            content: postContent,
          },
          params: { receive_id_type: 'chat_id' },
        })
        return
      } catch (postErr) {
        console.warn('[FeishuChannel] post send failed, fallback to text:', postErr)
      }
    } else {
      console.warn('[FeishuChannel] post payload exceeds size limit, fallback to text')
    }

    const textChunks = this.splitByLinePreserveLimit(
      content,
      FeishuChannel.MAX_TEXT_MESSAGE_BYTES,
      (chunk) => this.buildTextContent(chunk, options),
    )
    for (let i = 0; i < textChunks.length; i++) {
      await this.client.im.message.create({
        data: {
          receive_id: sessionId,
          msg_type: 'text',
          content: this.buildTextContent(textChunks[i], i === 0 ? options : undefined),
        },
        params: { receive_id_type: 'chat_id' },
      })
    }
  }

  private async sendReplyWithFallback(messageId: string, content: string): Promise<void> {
    if (!this.client) return

    const interactiveContent = this.buildMarkdownCardV2(content)
    if (this.byteLength(interactiveContent) <= FeishuChannel.MAX_RICH_MESSAGE_BYTES) {
      try {
        await this.client.im.message.reply({
          path: { message_id: messageId },
          data: {
            content: interactiveContent,
            msg_type: 'interactive',
          },
        })
        return
      } catch (interactiveErr) {
        console.warn('[FeishuChannel] interactive reply failed, fallback to post:', interactiveErr)
      }
    } else {
      console.warn('[FeishuChannel] interactive reply payload exceeds size limit, fallback to post')
    }

    const postContent = this.buildPostContent(content)
    if (this.byteLength(postContent) <= FeishuChannel.MAX_RICH_MESSAGE_BYTES) {
      try {
        await this.client.im.message.reply({
          path: { message_id: messageId },
          data: {
            content: postContent,
            msg_type: 'post',
          },
        })
        return
      } catch (postErr) {
        console.warn('[FeishuChannel] post reply failed, fallback to text:', postErr)
      }
    } else {
      console.warn('[FeishuChannel] post reply payload exceeds size limit, fallback to text')
    }

    try {
      const textChunks = this.splitByLinePreserveLimit(
        content,
        FeishuChannel.MAX_TEXT_MESSAGE_BYTES,
        (chunk) => this.buildTextContent(chunk),
      )
      for (const textChunk of textChunks) {
        await this.client.im.message.reply({
          path: { message_id: messageId },
          data: {
            content: this.buildTextContent(textChunk),
            msg_type: 'text',
          },
        })
      }
    } catch (textErr) {
      console.error('[FeishuChannel] text reply fallback failed:', textErr)
      throw textErr
    }
  }

  /**
   * Parse Feishu post (rich text) message into Markdown text + image attachments.
   *
   * Standard format: { "zh_cn": { "title": "...", "content": [[elements]] } }
   * Also handles: top-level { "title", "content" } without locale wrapper.
   */
  private parsePostContent(parsed: any, images: ImageAttachment[]): string {
    // Resolve locale wrapper: zh_cn > en_us > first locale-shaped value > top-level
    let doc: { title?: string; content?: any[][] } | undefined
    if (parsed.zh_cn?.content) {
      doc = parsed.zh_cn
    } else if (parsed.en_us?.content) {
      doc = parsed.en_us
    } else {
      // Try each top-level value for a locale-shaped object { content: [[...]] }
      for (const val of Object.values(parsed)) {
        if (val && typeof val === 'object' && Array.isArray((val as any).content)) {
          doc = val as any
          break
        }
      }
      // Fallback: top-level { content: [[...]] } without locale key
      if (!doc && Array.isArray(parsed.content)) {
        doc = parsed
      }
    }

    if (!doc?.content || !Array.isArray(doc.content)) {
      console.warn('[FeishuChannel] Unrecognized post structure:', JSON.stringify(parsed).slice(0, 200))
      // Last resort: recursively extract all text values from the JSON
      return this.extractTextFromJson(parsed)
    }

    const parts: string[] = []
    if (doc.title) parts.push(`# ${doc.title}`)

    for (const paragraph of doc.content) {
      if (!Array.isArray(paragraph)) continue
      const lineParts: string[] = []
      for (const el of paragraph) {
        lineParts.push(this.parsePostElement(el, images))
      }
      const line = lineParts.join('')
      if (line) parts.push(line)
    }

    const result = parts.join('\n\n')
    if (result.trim()) return result

    // Parsing succeeded structurally but no text extracted — extract from raw JSON
    console.warn('[FeishuChannel] Post parsed but empty, extracting raw text:', JSON.stringify(parsed).slice(0, 200))
    return this.extractTextFromJson(parsed)
  }

  /**
   * Convert a single post element to Markdown.
   */
  private parsePostElement(el: any, images: ImageAttachment[]): string {
    if (!el || typeof el !== 'object') return ''
    switch (el.tag) {
      case 'text': {
        let t = el.text ?? ''
        const s = el.style as string[] | undefined
        if (s?.includes('bold')) t = `**${t}**`
        if (s?.includes('italic')) t = `*${t}*`
        if (s?.includes('lineThrough')) t = `~~${t}~~`
        if (s?.includes('underline')) t = `<u>${t}</u>`
        return t
      }
      case 'a':
        return el.href ? `[${el.text ?? ''}](${el.href})` : el.text ?? ''
      case 'img':
        // Image download is async — handled separately by caller if client is available
        if (el.image_key) {
          // Queue image for download (caller handles async download)
          images.push({ mediaType: '__pending__', data: el.image_key })
        }
        return '[图片]'
      case 'at':
        return `@${el.user_name ?? el.user_id ?? 'user'}`
      case 'media':
        return `[${el.file_name ?? 'media'}]`
      case 'emotion':
        return el.emoji_type ? `:${el.emoji_type}:` : ''
      default:
        // Unknown tag — extract text if present
        return el.text ?? ''
    }
  }

  /**
   * Recursively extract all text values from an arbitrary JSON structure.
   * Used as last-resort when standard post parsing fails.
   */
  private extractTextFromJson(obj: unknown): string {
    if (typeof obj === 'string') return obj
    if (!obj || typeof obj !== 'object') return ''
    const texts: string[] = []
    for (const val of Object.values(obj)) {
      if (typeof val === 'string' && val.trim()) {
        texts.push(val)
      } else if (typeof val === 'object' && val !== null) {
        const nested = this.extractTextFromJson(val)
        if (nested) texts.push(nested)
      }
    }
    return texts.join(' ')
  }
}
