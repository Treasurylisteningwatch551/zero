import type {
  Memory,
  MemorySearchOptions,
  MemoryScoreBreakdown,
  ScoredMemoryMatch,
} from '@zero-os/shared'
import type { EmbeddingProvider } from './embedding'
import type { MemoryRepository } from './store'
import type { VectorIndexLike } from './vector-index'

const DEFAULT_TYPES: Memory['type'][] = ['session', 'incident', 'runbook', 'decision', 'note', 'inbox', 'preference']

export interface MemoryRetrieverConfig {
  vectorWeight?: number
  keywordWeight?: number
  recencyWeight?: number
  recencyHalfLifeDays?: number
}

/**
 * Memory retriever — searches memories by relevance.
 * Supports hybrid vector search, tag filters, and confidence thresholds.
 */
export class MemoryRetriever {
  constructor(
    private store: MemoryRepository,
    private embeddingClient?: EmbeddingProvider,
    private vectorIndex?: VectorIndexLike,
    private config: MemoryRetrieverConfig = {},
  ) {}

  async retrieve(query: string, options: MemorySearchOptions = {}): Promise<Memory[]> {
    return (await this.retrieveScored(query, options)).map((entry) => entry.memory)
  }

  async retrieveScored(query: string, options: MemorySearchOptions = {}): Promise<ScoredMemoryMatch[]> {
    const { topN = 5, confidenceThreshold = 0.6, types, tags, status } = options
    const keywords = extractKeywords(query)
    const targetTypes = types ?? DEFAULT_TYPES

    let allMemories: Memory[] = []
    for (const type of targetTypes) {
      allMemories.push(...this.store.list(type))
    }

    if (status) {
      allMemories = allMemories.filter((memory) => status.includes(memory.status))
    } else {
      allMemories = allMemories.filter((memory) => memory.status === 'verified')
    }

    allMemories = allMemories.filter((memory) => memory.confidence >= confidenceThreshold)

    const keywordScores = new Map<string, number>()
    const recencyScores = new Map<string, number>()
    for (const memory of allMemories) {
      keywordScores.set(memory.id, computeKeywordScore(memory, keywords, tags ?? []))
      recencyScores.set(memory.id, computeRecencyScore(memory, this.recencyHalfLifeDays))
    }

    let vectorScores = new Map<string, number>()
    if (query.trim() && this.embeddingClient && this.vectorIndex) {
      try {
        const queryVector = await this.embeddingClient.embed(query)
        const vectorResults = await this.vectorIndex.query(queryVector, Math.max(topN * 3, topN))
        vectorScores = new Map(vectorResults.map((result) => [result.memoryId, result.score]))
      } catch (error) {
        console.warn('[memory] vector retrieval failed, falling back to keyword search', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const maxKeywordScore = Math.max(0, ...keywordScores.values())

    const scored = allMemories.map((memory) => {
      const keyword = normalizeScore(keywordScores.get(memory.id) ?? 0, maxKeywordScore)
      const recency = recencyScores.get(memory.id) ?? 0
      const vector = vectorScores.get(memory.id)
      const scoreBreakdown: MemoryScoreBreakdown = {
        keyword,
        recency,
        ...(vector !== undefined ? { vector } : {}),
      }

      const hasSemanticSignal = keyword > 0 || (vector ?? 0) > 0
      const score = hasSemanticSignal
        ? this.keywordWeight * keyword +
          this.recencyWeight * recency +
          this.vectorWeight * (vector ?? 0)
        : 0

      return {
        memory,
        score,
        scoreBreakdown,
      }
    })

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.memory.confidence - a.memory.confidence
    })

    return scored
      .filter((entry) => entry.score > 0)
      .slice(0, topN)
  }

  private get vectorWeight(): number {
    return this.embeddingClient && this.vectorIndex ? this.config.vectorWeight ?? 0.5 : 0
  }

  private get keywordWeight(): number {
    return this.config.keywordWeight ?? 0.3
  }

  private get recencyWeight(): number {
    return this.config.recencyWeight ?? 0.2
  }

  private get recencyHalfLifeDays(): number {
    return this.config.recencyHalfLifeDays ?? 30
  }
}

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((word) => word.length > 1)
}

function computeKeywordScore(memory: Memory, keywords: string[], filterTags: string[]): number {
  let score = 0

  for (const tag of memory.tags) {
    const normalizedTag = tag.toLowerCase()
    if (filterTags.includes(tag)) score += 3
    if (keywords.includes(normalizedTag)) score += 2
  }

  const titleLower = memory.title.toLowerCase()
  for (const keyword of keywords) {
    if (titleLower.includes(keyword)) score += 2
  }

  const contentLower = memory.content.toLowerCase()
  for (const keyword of keywords) {
    if (contentLower.includes(keyword)) score += 1
  }

  return score
}

function computeRecencyScore(memory: Memory, recencyHalfLifeDays: number): number {
  const ageInDays = (Date.now() - new Date(memory.updatedAt).getTime()) / 86_400_000
  if (!Number.isFinite(ageInDays) || ageInDays < 0) return 1
  return Math.exp(-ageInDays / recencyHalfLifeDays)
}

function normalizeScore(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0
  return score / maxScore
}
