/**
 * Normalize markdown text to avoid channel-specific rendering drift.
 */
export function normalizeMarkdownForChannels(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replaceAll(String.fromCharCode(0), '')
    .replace(/\u200b/g, '')
    .trimEnd()
}
