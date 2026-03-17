export interface ProtectedMarkdownCodeContent {
  processed: string
  restore(input: string): string
}

export function protectMarkdownCodeContent(
  text: string,
  placeholderPrefix = 'CODE',
): ProtectedMarkdownCodeContent {
  const codeBlocks: string[] = []
  let processed = text.replace(/```[\s\S]*?```/g, (match) => {
    return `__${placeholderPrefix}_BLOCK_${codeBlocks.push(match) - 1}__`
  })

  const inlineCode: string[] = []
  processed = processed.replace(/`[^`]+`/g, (match) => {
    return `__${placeholderPrefix}_INLINE_${inlineCode.push(match) - 1}__`
  })

  return {
    processed,
    restore: (input: string) => {
      let restored = input

      inlineCode.forEach((code, i) => {
        restored = restored.replace(`__${placeholderPrefix}_INLINE_${i}__`, code)
      })
      codeBlocks.forEach((block, i) => {
        restored = restored.replace(`__${placeholderPrefix}_BLOCK_${i}__`, block)
      })

      return restored
    },
  }
}
