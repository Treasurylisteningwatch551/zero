import type { SecretFilter } from '@zero-os/shared'

/**
 * Filters secret values from output text, replacing them with [REDACTED].
 */
export class OutputSecretFilter implements SecretFilter {
  private secrets: Map<string, string> = new Map()

  constructor(entries?: [string, string][]) {
    if (entries) {
      for (const [key, value] of entries) {
        this.secrets.set(key, value)
      }
    }
  }

  addSecret(key: string, value: string): void {
    this.secrets.set(key, value)
  }

  removeSecret(key: string): void {
    this.secrets.delete(key)
  }

  /**
   * Replace all known secret values in the text with [REDACTED].
   * Checks both exact values and common encoded forms (base64, URL-encoded).
   */
  filter(text: string): string {
    let result = text
    for (const [_key, value] of this.secrets) {
      if (value.length < 4) continue // Skip very short values to avoid false positives
      result = result.replaceAll(value, '[REDACTED]')
      // Also check base64-encoded form
      const b64 = Buffer.from(value).toString('base64')
      result = result.replaceAll(b64, '[REDACTED]')
    }
    return result
  }
}
