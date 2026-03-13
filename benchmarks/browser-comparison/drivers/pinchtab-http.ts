/**
 * PinchTab HTTP API driver.
 * Communicates with PinchTab server via REST API (default: http://localhost:9867).
 */

import type { BrowserDriver, DriverResult, SnapshotOptions } from './base'
import { runHTTP } from './base'

export class PinchTabHTTPDriver implements BrowserDriver {
  readonly name = 'pinchtab-http'
  private baseUrl: string

  constructor(baseUrl = 'http://localhost:9867') {
    this.baseUrl = baseUrl
  }

  async startup(): Promise<void> {
    const result = await this.health()
    if (!result.success) {
      throw new Error(
        `pinchtab HTTP: Server not available at ${this.baseUrl}. Start with: pinchtab\n${result.error}`,
      )
    }
  }

  async shutdown(): Promise<void> {
    // PinchTab server runs persistently; no per-session shutdown needed
  }

  async health(): Promise<DriverResult> {
    return runHTTP(`${this.baseUrl}/health`, { timeout: 5000 })
  }

  async navigate(url: string, opts?: { wait?: string; newTab?: boolean }): Promise<DriverResult> {
    const body: Record<string, unknown> = { url }
    if (opts?.newTab) body.newTab = true
    return runHTTP(`${this.baseUrl}/navigate`, { method: 'POST', body })
  }

  async snapshot(opts?: SnapshotOptions): Promise<DriverResult> {
    const params = new URLSearchParams()
    if (opts?.interactive) params.set('filter', 'interactive')
    if (opts?.diff) params.set('diff', 'true')
    if (opts?.format) params.set('format', opts.format)
    const qs = params.toString()
    return runHTTP(`${this.baseUrl}/snapshot${qs ? `?${qs}` : ''}`)
  }

  async text(opts?: { mode?: 'readability' | 'raw' }): Promise<DriverResult> {
    const params = new URLSearchParams()
    if (opts?.mode === 'raw') params.set('mode', 'raw')
    const qs = params.toString()
    return runHTTP(`${this.baseUrl}/text${qs ? `?${qs}` : ''}`)
  }

  async click(ref: string): Promise<DriverResult> {
    return runHTTP(`${this.baseUrl}/action`, {
      method: 'POST',
      body: { kind: 'click', ref },
    })
  }

  async fill(ref: string, value: string): Promise<DriverResult> {
    return runHTTP(`${this.baseUrl}/action`, {
      method: 'POST',
      body: { kind: 'fill', ref, text: value },
    })
  }

  async press(ref: string, key: string): Promise<DriverResult> {
    return runHTTP(`${this.baseUrl}/action`, {
      method: 'POST',
      body: { kind: 'press', ref, key },
    })
  }

  async select(ref: string, value: string): Promise<DriverResult> {
    return runHTTP(`${this.baseUrl}/action`, {
      method: 'POST',
      body: { kind: 'select', ref, value },
    })
  }

  async hover(ref: string): Promise<DriverResult> {
    return runHTTP(`${this.baseUrl}/action`, {
      method: 'POST',
      body: { kind: 'hover', ref },
    })
  }

  async evalJS(expression: string): Promise<DriverResult> {
    return runHTTP(`${this.baseUrl}/evaluate`, {
      method: 'POST',
      body: { expression },
    })
  }

  async screenshot(): Promise<DriverResult> {
    return runHTTP(`${this.baseUrl}/screenshot`)
  }
}
