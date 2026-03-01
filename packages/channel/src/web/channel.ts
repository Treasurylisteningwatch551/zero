import type { Channel, MessageHandler } from '../base'
import { WebMessageHandler } from './handler'

/**
 * Web channel — wraps WebMessageHandler into a proper Channel implementation.
 * The web channel is always "connected" when the server is running.
 */
export class WebChannel implements Channel {
  readonly name = 'web'
  readonly type = 'web'

  private handler: WebMessageHandler
  private running = false

  constructor(handler?: WebMessageHandler) {
    this.handler = handler ?? new WebMessageHandler()
  }

  async start(): Promise<void> {
    this.running = true
  }

  async stop(): Promise<void> {
    this.running = false
  }

  async send(_sessionId: string, _content: string): Promise<void> {
    // Web channel sends via WebSocket broadcast from the server,
    // not through this method. This is handled by the bus → WS bridge.
  }

  isConnected(): boolean {
    return this.running
  }

  setMessageHandler(handler: MessageHandler): void {
    this.handler.setMessageHandler(handler)
  }

  /**
   * Access the underlying WebMessageHandler for WS routing.
   */
  getHandler(): WebMessageHandler {
    return this.handler
  }
}
