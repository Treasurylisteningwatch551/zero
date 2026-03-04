/**
 * Normalize markdown text to avoid channel-specific rendering drift.
 */
export function normalizeMarkdownForChannels(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\u200b/g, '')
    .trimEnd()
}
