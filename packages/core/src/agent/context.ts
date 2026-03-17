import type { Message, ToolResultBlock } from '@zero-os/shared'
import { estimateMessageTokens } from '@zero-os/shared'
import { CONTEXT_PARAMS } from './params'

/**
 * Prepare conversation history with progressive tool output reduction.
 * Does NOT modify the original messages array — returns a new array.
 *
 * Turn counting: each user message with a text block starts a new turn.
 * Turns are numbered from the end: most recent turn = 0.
 *
 * 0-3 turns: full tool output preserved
 * 4-8 turns: tool_result content truncated to ~200 chars summary
 * 9+ turns: tool_result replaced with success/failure status only
 */
export function prepareConversationHistory(messages: Message[]): Message[] {
  if (messages.length === 0) return []

  // Assign turn indices by scanning from the end
  const turnBoundaries: number[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (startsTopLevelTurn(msg)) {
      turnBoundaries.push(i)
    }
  }
  // turnBoundaries[0] = most recent user text message index (turn 0)

  // Build a map: message index -> turn age (distance from most recent turn)
  const turnAgeMap = new Map<number, number>()
  for (let t = 0; t < turnBoundaries.length; t++) {
    const startIdx = turnBoundaries[t]
    const endIdx = t === 0 ? messages.length : turnBoundaries[t - 1]
    for (let i = startIdx; i < endIdx; i++) {
      turnAgeMap.set(i, t)
    }
  }
  // Messages before the oldest identified turn get max age
  if (turnBoundaries.length > 0) {
    const oldestTurnStart = turnBoundaries[turnBoundaries.length - 1]
    for (let i = 0; i < oldestTurnStart; i++) {
      turnAgeMap.set(i, turnBoundaries.length)
    }
  }

  return messages.map((msg, idx) => {
    // Only process user messages with tool_result blocks
    if (msg.role !== 'user') return msg
    const hasToolResult = msg.content.some((b) => b.type === 'tool_result')
    if (!hasToolResult) return msg

    const age = turnAgeMap.get(idx) ?? turnBoundaries.length
    if (age <= CONTEXT_PARAMS.history.fullRetainTurns) return msg // Recent: keep full

    // Process content blocks
    const newContent = msg.content.map((block) => {
      if (block.type !== 'tool_result') return block

      if (age <= CONTEXT_PARAMS.history.summaryRetainTurns) {
        // Mid-range: truncate to ~200 char summary
        return summarizeToolResult(block)
      }
      // Old: replace with status only
      return statusOnlyToolResult(block)
    })

    return { ...msg, content: newContent }
  })
}

function startsTopLevelTurn(message: Message): boolean {
  return (
    message.role === 'user' &&
    message.messageType !== 'queued' &&
    message.content.some((block) => block.type === 'text')
  )
}

function summarizeToolResult(block: ToolResultBlock): ToolResultBlock {
  const summary =
    block.outputSummary ?? block.content.slice(0, CONTEXT_PARAMS.history.summaryMaxChars)
  const truncated = summary.length < block.content.length ? `${summary}...` : summary
  return { ...block, content: truncated }
}

function statusOnlyToolResult(block: ToolResultBlock): ToolResultBlock {
  if (block.isError) {
    const errorSnippet = block.content.slice(0, 100)
    return { ...block, content: `\u2717 failed: ${errorSnippet}` }
  }
  return { ...block, content: '\u2713 success' }
}

/**
 * Estimate total tokens in a conversation history.
 */
export function estimateConversationTokens(messages: Message[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateMessageTokens(msg.content)
    total += 4 // overhead per message (role, metadata)
  }
  return total
}
