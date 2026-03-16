import type { SnapshotEntry } from '@zero-os/observe'
import { generatePrefixedId } from '@zero-os/shared'

export interface SnapshotParams {
  sessionId: string
  trigger: string
  model?: string
  systemPrompt?: string
  tools?: string[]
  parentSnapshot?: string
  identityMemory?: string
  compressedSummary?: string
  messagesBefore?: number
  messagesAfter?: number
  compressedRange?: string
}

/**
 * Build a snapshot payload for trace persistence and legacy fallback ledgers.
 * When serialized as JSONL, the `ts` field is added by the caller if needed.
 */
export function buildSnapshot(params: SnapshotParams): Omit<SnapshotEntry, 'ts'> {
  return {
    id: generatePrefixedId('snap'),
    ...params,
  }
}
