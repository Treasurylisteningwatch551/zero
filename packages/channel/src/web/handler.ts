import type { IncomingMessage, MessageHandler } from '../base'

export interface WebSocketMessage {
  type: 'subscribe' | 'message' | 'ping'
  topics?: string[]
  content?: string
  sessionId?: string
}

export interface WebSocketResponse {
  type: 'event' | 'stream' | 'pong' | 'error'
  topic?: string
  sessionId?: string
  data?: unknown
  delta?: string
  error?: string
}

/**
 * Handles incoming WebSocket messages and routes them appropriately.
 */
export class WebMessageHandler {
  private messageHandler: MessageHandler | null = null
  private subscriptions: Map<string, Set<string>> = new Map() // clientId -> topics

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  /**
   * Process an incoming WebSocket message.
   */
  async handleMessage(clientId: string, raw: string): Promise<WebSocketResponse | null> {
    let msg: WebSocketMessage
    try {
      msg = JSON.parse(raw) as WebSocketMessage
    } catch {
      return { type: 'error', error: 'Invalid JSON' }
    }

    switch (msg.type) {
      case 'subscribe': {
        this.subscriptions.set(clientId, new Set(msg.topics ?? []))
        return null // No response needed
      }

      case 'message': {
        if (!msg.content) {
          return { type: 'error', error: 'Missing content' }
        }

        if (this.messageHandler) {
          const incoming: IncomingMessage = {
            channelType: 'web',
            senderId: clientId,
            content: msg.content,
            timestamp: new Date().toISOString(),
            metadata: { sessionId: msg.sessionId },
          }
          await this.messageHandler(incoming)
        }

        return null
      }

      case 'ping':
        return { type: 'pong' }

      default:
        return { type: 'error', error: `Unknown message type` }
    }
  }

  /**
   * Check if a client is subscribed to a topic.
   */
  isSubscribed(clientId: string, topic: string): boolean {
    const subs = this.subscriptions.get(clientId)
    if (!subs) return false

    for (const sub of subs) {
      if (sub === topic) return true
      if (sub.endsWith(':*') && topic.startsWith(sub.slice(0, -1))) return true
      if (sub === '*') return true
    }
    return false
  }

  removeClient(clientId: string): void {
    this.subscriptions.delete(clientId)
  }
}
