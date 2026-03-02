import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import matter from 'gray-matter'
import type { Memory, MemoryType, MemoryStatus } from '@zero-os/shared'
import { generatePrefixedId, now } from '@zero-os/shared'

/**
 * Memory store — CRUD operations for Markdown + Frontmatter memory files.
 */
export class MemoryStore {
  private basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
  }

  /**
   * Create a new memory entry.
   */
  create(type: MemoryType, title: string, content: string, options?: Partial<Memory>): Memory {
    const memory: Memory = {
      id: generatePrefixedId('mem'),
      type,
      title,
      createdAt: now(),
      updatedAt: now(),
      status: 'draft',
      confidence: 0.5,
      tags: [],
      related: [],
      content,
      ...options,
    }

    this.save(memory)
    return memory
  }

  /**
   * Save a memory to disk as Markdown + Frontmatter.
   */
  save(memory: Memory): void {
    const dir = this.typeDir(memory.type)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const filePath = join(dir, `${memory.id}.md`)
    const { content, ...frontmatter } = memory
    const fileContent = matter.stringify(content, frontmatter)
    writeFileSync(filePath, fileContent, 'utf-8')
  }

  /**
   * Read a memory by ID and type.
   */
  get(type: MemoryType, id: string): Memory | undefined {
    const filePath = join(this.typeDir(type), `${id}.md`)
    if (!existsSync(filePath)) return undefined
    return this.parseFile(filePath)
  }

  /**
   * List all memories of a given type.
   */
  list(type: MemoryType): Memory[] {
    const dir = this.typeDir(type)
    if (!existsSync(dir)) return []

    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => this.parseFile(join(dir, f)))
      .filter((m): m is Memory => m !== undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /**
   * Search memories by tags.
   */
  searchByTags(tags: string[], types?: MemoryType[]): Memory[] {
    const targetTypes = types ?? (['session', 'incident', 'runbook', 'decision', 'note'] as MemoryType[])
    const results: Memory[] = []

    for (const type of targetTypes) {
      const memories = this.list(type)
      for (const mem of memories) {
        if (tags.some((t) => mem.tags.includes(t))) {
          results.push(mem)
        }
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Update a memory's metadata.
   */
  update(type: MemoryType, id: string, updates: Partial<Memory>): Memory | undefined {
    const memory = this.get(type, id)
    if (!memory) return undefined

    const updated: Memory = {
      ...memory,
      ...updates,
      id: memory.id,
      type: memory.type,
      createdAt: memory.createdAt,
      updatedAt: now(),
    }

    this.save(updated)
    return updated
  }

  /**
   * Delete a memory file.
   */
  delete(type: MemoryType, id: string): boolean {
    const filePath = join(this.typeDir(type), `${id}.md`)
    if (!existsSync(filePath)) return false
    const { unlinkSync } = require('node:fs')
    unlinkSync(filePath)
    return true
  }

  private typeDir(type: MemoryType): string {
    const dirMap: Record<MemoryType, string> = {
      session: 'sessions',
      incident: 'incidents',
      runbook: 'runbooks',
      decision: 'decisions',
      note: 'notes',
      preference: 'preferences',
      inbox: 'inbox',
    }
    return join(this.basePath, dirMap[type])
  }

  private parseFile(filePath: string): Memory | undefined {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const { data, content } = matter(raw)
      return {
        id: data.id ?? basename(filePath, '.md'),
        type: data.type ?? 'note',
        title: data.title ?? '',
        createdAt: data.createdAt ?? data.created_at ?? now(),
        updatedAt: data.updatedAt ?? data.updated_at ?? now(),
        status: data.status ?? 'draft',
        confidence: data.confidence ?? 0.5,
        tags: data.tags ?? [],
        related: data.related ?? [],
        content: content.trim(),
      }
    } catch {
      return undefined
    }
  }
}
