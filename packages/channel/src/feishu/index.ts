import * as lark from '@larksuiteoapi/node-sdk'
import type { Readable } from 'node:stream'
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

interface FeishuBinaryResponse {
  getReadableStream: () => Readable
  headers?: unknown
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
    const sdkLogger = this.createSdkLogger()

    this.client = new lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: lark.LoggerLevel.error,
      logger: sdkLogger,
    })

    this.eventDispatcher = new lark.EventDispatcher({
      encryptKey: this.config.encryptKey ?? '',
      verificationToken: this.config.verificationToken ?? '',
      loggerLevel: lark.LoggerLevel.error,
      logger: sdkLogger,
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
          const incoming = await this.buildIncomingMessage(data)
          if (!incoming) return

          // Fire-and-forget: return immediately so SDK sends ACK within 3s
          this.messageHandler(incoming).catch((err) => {
            console.error('[FeishuChannel] Async handler error:', this.describeError(err))
          })
        } catch (err) {
          console.error('[FeishuChannel] Error handling im.message.receive_v1:', this.describeError(err))
        }
      },
    })

    // Use WebSocket long connection for event delivery (no webhook/ngrok needed)
    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: lark.LoggerLevel.error,
      logger: sdkLogger,
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

  private async buildIncomingMessage(data: any): Promise<IncomingMessage | null> {
    const msg = data?.message
    if (!msg) {
      console.warn('[FeishuChannel] Received event with no message payload')
      return null
    }

    const messageId = typeof msg.message_id === 'string' ? msg.message_id : ''
    let content = ''
    const images: ImageAttachment[] = []

    if (msg.message_type === 'text') {
      try {
        const parsed = JSON.parse(msg.content ?? '{}')
        content = parsed.text ?? ''
      } catch (parseErr) {
        console.error('[FeishuChannel] Failed to parse message content:', this.describeError(parseErr))
        content = msg.content ?? ''
      }
    } else if (msg.message_type === 'post') {
      try {
        const parsed = JSON.parse(msg.content ?? '{}')
        const pendingImages: ImageAttachment[] = []
        content = this.parsePostContent(parsed, pendingImages)

        if (messageId) {
          const downloads = pendingImages
            .filter((image) => image.mediaType === '__pending__')
            .map((image) => this.downloadMessageImage(messageId, image.data, 'Failed to download post image'))
          const resolvedImages = await Promise.all(downloads)
          images.push(...resolvedImages.filter((image): image is ImageAttachment => image !== null))
        }

        if (images.length > 0) {
          content = this.removeImagePlaceholders(content)
        }

        if (images.length === 0 && this.isPureImagePlaceholder(content)) {
          content = '[图片下载失败]'
        }
      } catch (parseErr) {
        console.error(
          '[FeishuChannel] Failed to parse post content:',
          this.describeError(parseErr),
          'raw:',
          this.truncate(msg.content ?? '', 200),
        )
        content = msg.content ?? ''
      }
    } else if (msg.message_type === 'image') {
      try {
        const parsed = JSON.parse(msg.content ?? '{}')
        const imageKey = typeof parsed.image_key === 'string' ? parsed.image_key : ''
        const image = imageKey && messageId
          ? await this.downloadMessageImage(messageId, imageKey, 'Failed to download image message')
          : null

        if (image) {
          images.push(image)
          content = ''
        } else {
          content = '[图片下载失败]'
        }
      } catch (parseErr) {
        console.error('[FeishuChannel] Failed to parse image message content:', this.describeError(parseErr))
        content = '[图片下载失败]'
      }
    } else {
      content = `[${msg.message_type} message]`
    }

    return {
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
  }

  /**
   * Add an emoji reaction to a message. Returns the reaction_id (for later removal) or null on failure.
   */
  async react(messageId: string, emojiType: string): Promise<string | null> {
    if (!this.client) return null
    try {
      const resp = await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      })
      return (resp as any)?.reaction_id ?? null
    } catch {
      return null
    }
  }

  /**
   * Remove a reaction by its reaction_id.
   */
  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    if (!this.client) return
    try {
      await this.client.im.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      })
    } catch {}
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
        console.warn('[FeishuChannel] interactive send failed, fallback to post:', this.describeError(interactiveErr))
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
        console.warn('[FeishuChannel] post send failed, fallback to text:', this.describeError(postErr))
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
        console.warn('[FeishuChannel] interactive reply failed, fallback to post:', this.describeError(interactiveErr))
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
        console.warn('[FeishuChannel] post reply failed, fallback to text:', this.describeError(postErr))
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
      console.error('[FeishuChannel] text reply fallback failed:', this.describeError(textErr))
      throw textErr
    }
  }

  private createSdkLogger() {
    const report = (level: 'error' | 'warn', args: unknown[]) => {
      const message = this.describeLogValue(args)
      if (!message) return
      const log = level === 'error' ? console.error : console.warn
      log('[FeishuSDK]', message)
    }

    return {
      error: (...msg: unknown[]) => report('error', msg),
      warn: (...msg: unknown[]) => report('warn', msg),
      info: () => {},
      debug: () => {},
      trace: () => {},
    }
  }

  private async downloadMessageImage(
    messageId: string,
    fileKey: string,
    logContext: string,
  ): Promise<ImageAttachment | null> {
    if (!this.client) return null

    try {
      const response = await this.client.im.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type: 'image' },
      })
      return await this.readBinaryResponse(response)
    } catch (error) {
      console.error(`[FeishuChannel] ${logContext}:`, this.describeError(error))
      return null
    }
  }

  private async readBinaryResponse(response: FeishuBinaryResponse): Promise<ImageAttachment> {
    const stream = response.getReadableStream()
    const chunks: Buffer[] = []

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk))
    }

    const buffer = Buffer.concat(chunks)
    return {
      mediaType: this.getResponseMediaType(response.headers),
      data: buffer.toString('base64'),
    }
  }

  private getResponseMediaType(headers: unknown): string {
    const contentType = this.getHeaderValue(headers, 'content-type')
    if (!contentType) return 'image/png'
    return contentType.split(';')[0]?.trim() || 'image/png'
  }

  private getHeaderValue(headers: unknown, headerName: string): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined

    const lowerName = headerName.toLowerCase()
    const withGetter = headers as { get?: (name: string) => unknown }
    if (typeof withGetter.get === 'function') {
      const value = withGetter.get(headerName) ?? withGetter.get(lowerName)
      return typeof value === 'string' ? value : undefined
    }

    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== lowerName) continue
      if (typeof value === 'string') return value
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
    }

    return undefined
  }

  private extractRequestId(headers: unknown): string | undefined {
    return this.getHeaderValue(headers, 'x-request-id')
      ?? this.getHeaderValue(headers, 'request-id')
  }

  private extractResponseDetail(data: unknown): string | undefined {
    if (!data) return undefined
    if (typeof data === 'string') return this.truncate(data, 160)
    if (typeof data !== 'object') return undefined

    const record = data as Record<string, unknown>
    const code = typeof record.code === 'number' || typeof record.code === 'string'
      ? String(record.code)
      : undefined
    const message = typeof record.msg === 'string'
      ? record.msg
      : typeof record.message === 'string'
        ? record.message
        : undefined

    if (!code && !message) return undefined
    return [code ? `code=${code}` : '', message ?? '']
      .filter(Boolean)
      .join(' ')
  }

  private describeLogValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.describeLogValue(item))
        .filter(Boolean)
        .join(' | ')
    }

    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value)

    const errorSummary = this.describeError(value)
    if (errorSummary !== '[unknown error]') return errorSummary

    const objectName = value && typeof value === 'object' && 'constructor' in value
      ? (value as { constructor?: { name?: string } }).constructor?.name
      : undefined
    return objectName ? `[${objectName}]` : '[object]'
  }

  private describeError(error: unknown): string {
    if (typeof error === 'string') return error
    if (typeof error === 'number' || typeof error === 'boolean' || error == null) return String(error)

    const record = error as Record<string, unknown>
    const response = typeof record.response === 'object' && record.response !== null
      ? record.response as Record<string, unknown>
      : undefined
    const config = typeof record.config === 'object' && record.config !== null
      ? record.config as Record<string, unknown>
      : undefined

    const message = typeof record.message === 'string'
      ? record.message
      : error instanceof Error
        ? error.message
        : undefined
    const code = typeof record.code === 'string' ? record.code : undefined
    const status = typeof response?.status === 'number'
      ? response.status
      : typeof record.status === 'number'
        ? record.status
        : typeof record.statusCode === 'number'
          ? record.statusCode
          : undefined
    const method = typeof config?.method === 'string' ? config.method.toUpperCase() : undefined
    const url = typeof config?.url === 'string'
      ? config.url
      : typeof record.url === 'string'
        ? record.url
        : undefined
    const requestId = this.extractRequestId(response?.headers)
    const detail = this.extractResponseDetail(response?.data)

    const parts = [
      status ? `status=${status}` : '',
      code ? `code=${code}` : '',
      requestId ? `request_id=${requestId}` : '',
      method || url ? `${method ?? 'REQUEST'} ${url ?? ''}`.trim() : '',
      message ?? '',
      detail ? `detail=${detail}` : '',
    ].filter(Boolean)

    return parts.join(' | ') || '[unknown error]'
  }

  private isPureImagePlaceholder(content: string): boolean {
    const normalized = this.removeImagePlaceholders(content).replace(/\s+/g, '')
    return normalized.length === 0 && content.replace(/\s+/g, '').length > 0
  }

  private removeImagePlaceholders(content: string): string {
    return content
      .replace(/^\s*\[(?:图片|Image(?:\s*#?\d+)?)\]\s*$/gim, '')
      .replace(/(?:\r?\n){3,}/g, '\n\n')
      .trim()
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value
    return `${value.slice(0, Math.max(0, maxLength - 1))}…`
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
