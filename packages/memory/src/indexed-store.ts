import type { Memory, MemoryType } from '@zero-os/shared'
import type { EmbeddingProvider } from './embedding'
import type { MemoryRepository } from './store'
import type { MemoryVectorMeta, VectorIndexLike } from './vector-index'

export class IndexedMemoryStore implements MemoryRepository {
  constructor(
    private store: MemoryRepository,
    private embeddingClient: EmbeddingProvider,
    private vectorIndex: VectorIndexLike,
  ) {}

  async create(type: MemoryType, title: string, content: string, options?: Partial<Memory>): Promise<Memory> {
    const memory = await this.store.create(type, title, content, options)

    try {
      await this.upsertMemory(memory)
      return memory
    } catch (error) {
      await this.store.delete(type, memory.id)
      throw error
    }
  }

  async save(memory: Memory): Promise<void> {
    await this.store.save(memory)
  }

  get(type: MemoryType, id: string): Memory | undefined {
    return this.store.get(type, id)
  }

  getRelativePath(type: MemoryType, id: string): string {
    return this.store.getRelativePath(type, id)
  }

  list(type: MemoryType): Memory[] {
    return this.store.list(type)
  }

  searchByTags(tags: string[], types?: MemoryType[]): Memory[] {
    return this.store.searchByTags(tags, types)
  }

  async update(type: MemoryType, id: string, updates: Partial<Memory>): Promise<Memory | undefined> {
    const existing = this.store.get(type, id)
    if (!existing) return undefined

    const updated = await this.store.update(type, id, updates)
    if (!updated) return undefined

    try {
      await this.upsertMemory(updated)
      return updated
    } catch (error) {
      await this.store.save(existing)
      throw error
    }
  }

  async delete(type: MemoryType, id: string): Promise<boolean> {
    const existing = this.store.get(type, id)
    if (!existing) return false

    await this.vectorIndex.delete(id)
    const deleted = await this.store.delete(type, id)
    if (deleted) return true

    await this.upsertMemory(existing)
    return false
  }

  getAgentPreference(agentName: string): string {
    return this.store.getAgentPreference(agentName)
  }

  async deleteBySessionId(sessionId: string): Promise<number> {
    const allTypes: MemoryType[] = ['session', 'incident', 'runbook', 'decision', 'note', 'preference', 'inbox']
    let deleted = 0

    for (const type of allTypes) {
      for (const memory of this.store.list(type)) {
        if (memory.sessionId !== sessionId) continue
        if (await this.delete(type, memory.id)) {
          deleted++
        }
      }
    }

    return deleted
  }

  readByPath(path: string, options?: { from?: number; lines?: number }): { path: string; text: string } | undefined {
    return this.store.readByPath(path, options)
  }

  async reindexAll(): Promise<number> {
    await this.vectorIndex.ensureIndex()

    const allTypes: MemoryType[] = ['session', 'incident', 'runbook', 'decision', 'note', 'preference', 'inbox']
    let count = 0

    for (const type of allTypes) {
      for (const memory of this.store.list(type)) {
        await this.upsertMemory(memory)
        count++
      }
    }

    return count
  }

  private async upsertMemory(memory: Memory): Promise<void> {
    const vector = await this.embeddingClient.embed(this.embeddingClient.memoryToText(memory))
    await this.vectorIndex.upsert(memory.id, vector, this.toVectorMeta(memory))
  }

  private toVectorMeta(memory: Memory): MemoryVectorMeta {
    return {
      memoryId: memory.id,
      type: memory.type,
      title: memory.title,
      updatedAt: memory.updatedAt,
    }
  }
}
