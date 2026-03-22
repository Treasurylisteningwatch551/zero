import type { ContentBlock, Message, TextBlock } from '../types'

function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text'
}

export function extractAssistantText(content: ContentBlock[]): string {
  return content.filter(isTextBlock).map((block) => block.text).join('')
}

export function collectAssistantReply(messages: Message[]): string {
  return messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.content)
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('\n')
    .trim()
}
