import type { Memory, MemoryType } from '@zero-os/shared'
import type { MemoryRepository } from './store'

/**
 * Memory lifecycle manager — handles write, organize, archive, and conflict resolution.
 */
export class MemoryLifecycle {
  constructor(private store: MemoryRepository) {}

  /**
   * Create a session memory from a completed session.
   */
  async createSessionMemory(sessionId: string, summary: string, tags: string[]): Promise<Memory> {
    return this.store.create('session', `Session ${sessionId}`, summary, {
      sessionId,
      tags,
      status: 'verified',
      confidence: 0.8,
    })
  }

  /**
   * Create an incident record from a failure event.
   */
  async createIncident(
    title: string,
    description: string,
    sessionId: string,
    tags: string[],
  ): Promise<Memory> {
    return this.store.create('incident', title, description, {
      sessionId,
      tags: ['incident', ...tags],
      status: 'draft',
      confidence: 0.7,
    })
  }

  /**
   * Verify a memory (mark as verified with high confidence).
   */
  async verify(type: MemoryType, id: string, confidence?: number): Promise<Memory | undefined> {
    return this.store.update(type, id, {
      status: 'verified',
      confidence: confidence ?? 0.9,
    })
  }

  /**
   * Archive old or low-value memories.
   */
  async archiveOld(type: MemoryType, olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
    const memories = this.store.list(type)
    let archived = 0

    for (const mem of memories) {
      if (mem.updatedAt < cutoff && mem.status !== 'archived') {
        await this.store.update(type, mem.id, { status: 'archived' })
        archived++
      }
    }

    return archived
  }

  /**
   * Resolve conflicts between two memories.
   * Higher confidence wins; if equal, more recent wins.
   */
  async resolveConflict(type: MemoryType, id1: string, id2: string): Promise<Memory | undefined> {
    const m1 = this.store.get(type, id1)
    const m2 = this.store.get(type, id2)
    if (!m1 || !m2) return undefined

    let winner: Memory
    let loser: Memory

    if (m1.confidence !== m2.confidence) {
      winner = m1.confidence > m2.confidence ? m1 : m2
      loser = m1.confidence > m2.confidence ? m2 : m1
    } else {
      winner = m1.updatedAt > m2.updatedAt ? m1 : m2
      loser = m1.updatedAt > m2.updatedAt ? m2 : m1
    }

    // Archive the loser
    await this.store.update(type, loser.id, { status: 'archived' })

    // Add reference to the winner
    const related = [...winner.related, loser.id]
    return this.store.update(type, winner.id, { related })
  }
}
