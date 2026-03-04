import { normalizeMarkdownForChannels } from './normalize'

/**
 * Feishu interactive cards already accept markdown-like content.
 * We only normalize line endings/control chars for consistency.
 */
export function renderMarkdownForFeishu(markdown: string): string {
  return normalizeMarkdownForChannels(markdown)
}
