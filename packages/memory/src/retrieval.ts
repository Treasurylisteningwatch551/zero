import type { Memory, MemorySearchOptions } from '@zero-os/shared'
import type { MemoryStore } from './store'

export interface ScoredMemoryMatch {
  memory: Memory
  score: number
}

/**
 * Memory retriever — searches memories by relevance.
 * Supports tag-based filtering and confidence thresholds.
 */
export class MemoryRetriever {
  private store: MemoryStore

  constructor(store: MemoryStore) {
    this.store = store
  }

  /**
   * Retrieve relevant memories for a given query.
   * Uses tag matching and confidence filtering.
   */
  async retrieve(query: string, options: MemorySearchOptions = {}): Promise<Memory[]> {
    return (await this.retrieveScored(query, options)).map((entry) => entry.memory)
  }

  async retrieveScored(query: string, options: MemorySearchOptions = {}): Promise<ScoredMemoryMatch[]> {
    const { topN = 5, confidenceThreshold = 0.6, types, tags, status } = options

    // Extract keywords from query for tag matching
    const keywords = extractKeywords(query)

    // Get all memories of specified types
    const targetTypes = types ?? ['session', 'incident', 'runbook', 'decision', 'note', 'inbox'] as Memory['type'][]
    let allMemories: Memory[] = []

    for (const type of targetTypes) {
      allMemories.push(...this.store.list(type))
    }

    // Filter by status
    if (status) {
      allMemories = allMemories.filter((m) => status.includes(m.status))
    } else {
      allMemories = allMemories.filter((m) => m.status === 'verified')
    }

    // Filter by confidence threshold
    allMemories = allMemories.filter((m) => m.confidence >= confidenceThreshold)

    // Score by relevance (tag overlap + keyword match in title/content)
    const scored = allMemories.map((m) => ({
      memory: m,
      score: computeRelevanceScore(m, keywords, tags ?? []),
    }))

    // Sort by score descending, then by confidence
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.memory.confidence - a.memory.confidence
    })

    // Return top N
    return scored
      .filter((s) => s.score > 0)
      .slice(0, topN)
  }
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;:.!?]+/)
    .filter((w) => w.length > 2)
    .filter((w) => !STOP_WORDS.has(w))
}

function computeRelevanceScore(memory: Memory, keywords: string[], filterTags: string[]): number {
  let score = 0

  // Tag match (high weight)
  for (const tag of memory.tags) {
    if (filterTags.includes(tag)) score += 3
    if (keywords.includes(tag.toLowerCase())) score += 2
  }

  // Title keyword match
  const titleLower = memory.title.toLowerCase()
  for (const kw of keywords) {
    if (titleLower.includes(kw)) score += 2
  }

  // Content keyword match (lower weight)
  const contentLower = memory.content.toLowerCase()
  for (const kw of keywords) {
    if (contentLower.includes(kw)) score += 1
  }

  return score
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'can', 'shall',
  'of', 'to', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'and', 'but', 'or', 'not', 'this', 'that', 'it', 'its',
])
