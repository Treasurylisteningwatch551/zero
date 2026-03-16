import { normalizeMarkdownForChannels } from './normalize'

interface RenderMarkdownForFeishuOptions {
  preserveExternalImages?: boolean
}

export function renderMarkdownForFeishu(
  markdown: string,
  options?: RenderMarkdownForFeishuOptions,
): string {
  let text = normalizeMarkdownForChannels(markdown)
  text = optimizeMarkdownForFeishu(text, options)
  return text
}

/**
 * Optimize markdown for Feishu card rendering:
 * 1. Heading downgrade: H1->H4, H2-H6->H5
 * 2. Table spacing: add paragraph breaks around tables
 * 3. Code block protection: don't modify content inside code blocks
 * 4. Strip invalid image references: only img_xxx keys are valid in Feishu
 * 5. Normalize @mentions: fix common AI mistakes in mention syntax
 * 6. Compress excessive blank lines
 */
function optimizeMarkdownForFeishu(
  text: string,
  options?: RenderMarkdownForFeishuOptions,
): string {
  const codeBlocks: string[] = []
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    return `__CODE_BLOCK_${codeBlocks.push(match) - 1}__`
  })

  if (/^#{1,3} /m.test(result)) {
    result = result.replace(/^#{2,6} (.+)$/gm, '##### $1')
    result = result.replace(/^# (.+)$/gm, '#### $1')
  }

  result = result.replace(/^([^|\n].*)\n(\|.+\|)/gm, '$1\n\n$2')
  result = result.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, '\n\n<br>\n\n$1')
  result = result.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, '$1\n<br>\n')

  result = result.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, _alt, src) => {
    if (src.startsWith('img_')) return match
    if (options?.preserveExternalImages) return match
    return ''
  })

  result = result.replace(
    /<at\s+(?:id|open_id|user_id)\s*=\s*"?([^">\s]+)"?\s*>/gi,
    '<at user_id="$1">',
  )

  codeBlocks.forEach((block, i) => {
    result = result.replace(`__CODE_BLOCK_${i}__`, block)
  })

  result = result.replace(/\n{3,}/g, '\n\n')

  return result
}
