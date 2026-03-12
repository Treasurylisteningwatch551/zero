import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryRetriever, extractKeywords } from '../retrieval'
import { MemoryStore } from '../store'
import type { EmbeddingProvider } from '../embedding'
import type { VectorIndexLike } from '../vector-index'

describe('MemoryRetriever', () => {
  let tmpDir: string
  let store: MemoryStore
  let retriever: MemoryRetriever

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zero-retrieval-'))
    store = new MemoryStore(tmpDir)

    await store.create('session', 'Deploy API gateway', 'Deployed nginx API gateway for routing', {
      tags: ['deploy', 'api', 'nginx'],
      status: 'verified',
      confidence: 0.9,
    })
    await store.create('incident', 'Database timeout error', 'Connection pool exhausted during peak load', {
      tags: ['incident', 'database', 'timeout'],
      status: 'verified',
      confidence: 0.85,
    })
    await store.create('note', 'Setup guide for Redis', 'Install and configure Redis for caching', {
      tags: ['redis', 'setup', 'cache'],
      status: 'verified',
      confidence: 0.7,
    })
    await store.create('session', 'Old archived session', 'This was archived', {
      tags: ['old'],
      status: 'archived',
      confidence: 0.5,
    })
    await store.create('note', 'Low confidence note', 'Some uncertain information', {
      tags: ['uncertain'],
      status: 'verified',
      confidence: 0.3,
    })

    retriever = new MemoryRetriever(store)
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('empty query on empty store returns empty array', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'zero-retrieval-empty-'))
    const emptyStore = new MemoryStore(emptyDir)
    const emptyRetriever = new MemoryRetriever(emptyStore)

    const results = await emptyRetriever.retrieve('')
    expect(results).toEqual([])

    rmSync(emptyDir, { recursive: true, force: true })
  })

  test('title keyword match finds deploy memory', async () => {
    const results = await retriever.retrieve('deploy')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].title).toBe('Deploy API gateway')
  })

  test('content keyword match finds deploy memory', async () => {
    const results = await retriever.retrieve('nginx')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.map((memory) => memory.title)).toContain('Deploy API gateway')
  })

  test('tag filter finds incident memory', async () => {
    const results = await retriever.retrieve('anything', { tags: ['database'] })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.map((memory) => memory.title)).toContain('Database timeout error')
  })

  test('confidenceThreshold filters low confidence memories', async () => {
    const results = await retriever.retrieve('uncertain')
    expect(results.length).toBe(0)
  })

  test('low confidenceThreshold includes low confidence memories', async () => {
    const results = await retriever.retrieve('uncertain', { confidenceThreshold: 0.1 })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.map((memory) => memory.title)).toContain('Low confidence note')
  })

  test('topN limits results', async () => {
    const results = await retriever.retrieve('deploy api gateway nginx', { topN: 1 })
    expect(results.length).toBe(1)
  })

  test('default excludes archived status', async () => {
    const results = await retriever.retrieve('old archived session', { confidenceThreshold: 0.1 })
    expect(results.map((memory) => memory.title)).not.toContain('Old archived session')
  })

  test('specified status filter returns archived memories', async () => {
    const results = await retriever.retrieve('old archived', {
      status: ['archived'],
      confidenceThreshold: 0.1,
    })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.map((memory) => memory.title)).toContain('Old archived session')
  })

  test('extractKeywords keeps Chinese and does not remove stop words', () => {
    expect(extractKeywords('the database is 超时')).toEqual(['the', 'database', 'is', '超时'])
  })

  test('hybrid scoring returns score breakdown with vector contribution', async () => {
    const embeddingClient: EmbeddingProvider = {
      async embed(): Promise<number[]> {
        return [0.9, 0.1]
      },
      async embedBatch(texts: string[]): Promise<number[][]> {
        return texts.map(() => [0.9, 0.1])
      },
      memoryToText(memory) {
        return memory.title
      },
    }

    const vectorIndex: VectorIndexLike = {
      async ensureIndex() {},
      async upsert() {},
      async query() {
        const deploy = store.list('session').find((memory) => memory.title === 'Deploy API gateway')
        const database = store.list('incident').find((memory) => memory.title === 'Database timeout error')
        return [
          { memoryId: deploy!.id, score: 0.95 },
          { memoryId: database!.id, score: 0.2 },
        ]
      },
      async delete() {},
      async getStats() {
        return { itemCount: 2 }
      },
    }

    const hybridRetriever = new MemoryRetriever(store, embeddingClient, vectorIndex, {
      vectorWeight: 0.5,
      keywordWeight: 0.3,
      recencyWeight: 0.2,
      recencyHalfLifeDays: 30,
    })

    const results = await hybridRetriever.retrieveScored('deploy infra', { topN: 3 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].memory.title).toBe('Deploy API gateway')
    expect(results[0].scoreBreakdown.vector).toBeDefined()
    expect(results[0].scoreBreakdown.keyword).toBeGreaterThan(0)
  })

  test('vector failure falls back to keyword plus recency', async () => {
    const failingEmbeddingClient: EmbeddingProvider = {
      async embed(): Promise<number[]> {
        throw new Error('boom')
      },
      async embedBatch(): Promise<number[][]> {
        throw new Error('boom')
      },
      memoryToText(memory) {
        return memory.title
      },
    }

    const unusedVectorIndex: VectorIndexLike = {
      async ensureIndex() {},
      async upsert() {},
      async query() {
        throw new Error('should not be called')
      },
      async delete() {},
      async getStats() {
        return { itemCount: 0 }
      },
    }

    const fallbackRetriever = new MemoryRetriever(store, failingEmbeddingClient, unusedVectorIndex)
    const results = await fallbackRetriever.retrieveScored('database timeout')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].memory.title).toBe('Database timeout error')
    expect(results[0].scoreBreakdown.vector).toBeUndefined()
  })

  test('recency boosts newer memories when keyword signal is tied', async () => {
    const recentDir = mkdtempSync(join(tmpdir(), 'zero-retrieval-recency-'))
    const recentStore = new MemoryStore(recentDir)
    const oldMemory = await recentStore.create('note', 'Deploy notes old', 'deploy notes', {
      tags: ['deploy'],
      status: 'verified',
      confidence: 0.8,
      updatedAt: '2025-01-01T00:00:00.000Z',
    })
    const recentMemory = await recentStore.create('note', 'Deploy notes recent', 'deploy notes', {
      tags: ['deploy'],
      status: 'verified',
      confidence: 0.8,
      updatedAt: '2026-03-10T00:00:00.000Z',
    })

    const recentRetriever = new MemoryRetriever(recentStore, undefined, undefined, {
      keywordWeight: 0.3,
      recencyWeight: 0.7,
      recencyHalfLifeDays: 30,
    })

    const results = await recentRetriever.retrieveScored('deploy')
    expect(results[0].memory.id).toBe(recentMemory.id)
    expect(results[1].memory.id).toBe(oldMemory.id)

    rmSync(recentDir, { recursive: true, force: true })
  })
})
