import type { ContentBlock, StreamEvent, TokenUsage } from '@zero-os/shared'

/**
 * Collects streaming events into a complete response.
 */
export async function collectStream(stream: AsyncIterable<StreamEvent>): Promise<{
  content: ContentBlock[]
  usage?: TokenUsage
}> {
  const textParts: string[] = []
  const toolCalls: Map<string, { id: string; name: string; arguments: string }> = new Map()
  let currentToolId: string | null = null
  let usage: TokenUsage | undefined

  for await (const event of stream) {
    switch (event.type) {
      case 'text_delta': {
        const data = event.data as { text: string }
        textParts.push(data.text)
        break
      }
      case 'tool_use_start': {
        const data = event.data as { id: string; name: string }
        currentToolId = data.id
        toolCalls.set(data.id, { id: data.id, name: data.name, arguments: '' })
        break
      }
      case 'tool_use_delta': {
        if (currentToolId) {
          const tc = toolCalls.get(currentToolId)
          if (tc) {
            const data = event.data as { arguments: string }
            tc.arguments += data.arguments
          }
        }
        break
      }
      case 'tool_use_end': {
        currentToolId = null
        break
      }
      case 'done': {
        const data = event.data as { usage?: TokenUsage }
        if (data.usage) usage = data.usage
        break
      }
    }
  }

  const content: ContentBlock[] = []

  if (textParts.length > 0) {
    content.push({ type: 'text', text: textParts.join('') })
  }

  for (const tc of toolCalls.values()) {
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.name,
      input: tc.arguments ? JSON.parse(tc.arguments) : {},
    })
  }

  return { content, usage }
}

/**
 * Creates a callback-based stream consumer for real-time output.
 */
export async function consumeStream(
  stream: AsyncIterable<StreamEvent>,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  for await (const event of stream) {
    onEvent(event)
  }
}
