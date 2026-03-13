import { LocalIndex } from 'vectra'

export interface MemoryVectorMeta extends Record<string, string> {
  memoryId: string
  type: string
  title: string
  updatedAt: string
}

export interface VectorIndexLike {
  ensureIndex(): Promise<void>
  upsert(memoryId: string, vector: number[], meta: MemoryVectorMeta): Promise<void>
  query(vector: number[], topK: number): Promise<Array<{ memoryId: string; score: number }>>
  delete(memoryId: string): Promise<void>
  getStats(): Promise<{ itemCount: number }>
}

export class VectorIndex implements VectorIndexLike {
  private index: LocalIndex<MemoryVectorMeta>

  constructor(indexPath: string) {
    this.index = new LocalIndex<MemoryVectorMeta>(indexPath)
  }

  async ensureIndex(): Promise<void> {
    const exists = await this.index.isIndexCreated()
    if (exists) return

    await this.index.createIndex({
      version: 1,
    })
  }

  async upsert(memoryId: string, vector: number[], meta: MemoryVectorMeta): Promise<void> {
    await this.ensureIndex()
    await this.index.upsertItem({
      id: memoryId,
      vector,
      metadata: {
        ...meta,
        memoryId,
      },
    })
  }

  async query(vector: number[], topK: number): Promise<Array<{ memoryId: string; score: number }>> {
    await this.ensureIndex()
    const results = await this.index.queryItems(vector, topK)
    return results.map((result) => ({
      memoryId: result.item.id,
      score: normalizeScore(result.score),
    }))
  }

  async delete(memoryId: string): Promise<void> {
    const exists = await this.index.isIndexCreated()
    if (!exists) return
    const existing = await this.index.getItem(memoryId)
    if (!existing) return
    await this.index.deleteItem(memoryId)
  }

  async getStats(): Promise<{ itemCount: number }> {
    const exists = await this.index.isIndexCreated()
    if (!exists) {
      return { itemCount: 0 }
    }

    const stats = await this.index.getIndexStats()
    return { itemCount: stats.items }
  }
}

function normalizeScore(score: number): number {
  if (Number.isNaN(score)) return 0
  if (score >= 0 && score <= 1) return score
  return Math.max(0, Math.min(1, (score + 1) / 2))
}
