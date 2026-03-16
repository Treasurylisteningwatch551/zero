/**
 * Channel capability hints — tells agents what the channel supports.
 * Injected into system prompt automatically so agents adapt their output
 * without per-channel hard-coding.
 */
export interface ChannelCapabilities {
  /** Channel supports streaming output (e.g. CardKit 2.0 typing effect) */
  streaming?: boolean
  /** Channel supports inline images in messages (image + text in one message) */
  inlineImages?: boolean
  /** Channel supports sending standalone image messages */
  imageMessages?: boolean
  /** Channel supports sending file attachments */
  fileMessages?: boolean
  /** Channel supports interactive cards / rich messages */
  interactiveCards?: boolean
  /** Channel supports @mention syntax */
  mentions?: boolean
  /** Channel supports emoji reactions on messages */
  reactions?: boolean
  /** Channel supports reply/quote to specific messages */
  threadReply?: boolean
  /** Markdown dialect notes (e.g. "no H1-H3, no external image URLs") */
  markdownNotes?: string
  /** Max message length in characters (if limited) */
  maxMessageLength?: number
}

/**
 * Channel interface — defines the contract for all communication channels.
 */
export interface Channel {
  readonly name: string
  readonly type: string

  /**
   * Start the channel (connect, listen for events).
   */
  start(): Promise<void>

  /**
   * Stop the channel gracefully.
   */
  stop(): Promise<void>

  /**
   * Send a message through the channel.
   */
  send(sessionId: string, content: string): Promise<void>

  /**
   * Check if the channel is connected and healthy.
   */
  isConnected(): boolean

  /**
   * Set the handler for incoming messages.
   */
  setMessageHandler(handler: MessageHandler): void

  /**
   * Declare what this channel supports.
   * Injected into agent system prompt automatically.
   */
  getCapabilities(): ChannelCapabilities
}

/**
 * Incoming message from a channel.
 */
export interface ImageAttachment {
  mediaType: string
  data: string // base64
}

export interface IncomingMessage {
  channelType: string
  senderId: string
  content: string
  timestamp: string
  metadata?: Record<string, unknown>
  images?: ImageAttachment[]
}

/**
 * Handler for incoming messages.
 */
export type MessageHandler = (message: IncomingMessage) => Promise<void>
