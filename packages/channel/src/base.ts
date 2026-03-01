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
}

/**
 * Incoming message from a channel.
 */
export interface IncomingMessage {
  channelType: string
  senderId: string
  content: string
  timestamp: string
  metadata?: Record<string, unknown>
}

/**
 * Handler for incoming messages.
 */
export type MessageHandler = (message: IncomingMessage) => Promise<void>
