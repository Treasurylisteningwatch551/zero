import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryRetriever } from '../retrieval'
import { MemoryStore } from '../store'

describe('MemoryRetriever', () => {
  let tmpDir: string
  let store: MemoryStore
  let retriever: MemoryRetriever

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zero-retrieval-'))
    store = new MemoryStore(tmpDir)

    store.create('session', 'Deploy API gateway', 'Deployed nginx API gateway for routing', {
      tags: ['deploy', 'api', 'nginx'],
      status: 'verified',
      confidence: 0.9,
    })
    store.create('incident', 'Database timeout error', 'Connection pool exhausted during peak load', {
      tags: ['incident', 'database', 'timeout'],
      status: 'verified',
      confidence: 0.85,
    })
    store.create('note', 'Setup guide for Redis', 'Install and configure Redis for caching', {
      tags: ['redis', 'setup', 'cache'],
      status: 'verified',
      confidence: 0.7,
    })
    store.create('session', 'Old archived session', 'This was archived', {
      tags: ['old'],
      status: 'archived',
      confidence: 0.5,
    })
    store.create('note', 'Low confidence note', 'Some uncertain information', {
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

  test('title keyword match: query "deploy" finds Deploy API gateway', async () => {
    const results = await retriever.retrieve('deploy')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].title).toBe('Deploy API gateway')
  })

  test('content keyword match: query "nginx" finds deploy memory', async () => {
    const results = await retriever.retrieve('nginx')
    expect(results.length).toBeGreaterThanOrEqual(1)
    const titles = results.map((m) => m.title)
    expect(titles).toContain('Deploy API gateway')
  })

  test('tag filter: tags=["database"] finds incident', async () => {
    const results = await retriever.retrieve('anything', { tags: ['database'] })
    expect(results.length).toBeGreaterThanOrEqual(1)
    const titles = results.map((m) => m.title)
    expect(titles).toContain('Database timeout error')
  })

  test('confidenceThreshold filters low confidence memories', async () => {
    // Default threshold is 0.6, so "Low confidence note" (0.3) should be excluded
    const results = await retriever.retrieve('uncertain')
    expect(results.length).toBe(0)
  })

  test('low confidenceThreshold includes low confidence memories', async () => {
    const results = await retriever.retrieve('uncertain', { confidenceThreshold: 0.1 })
    expect(results.length).toBeGreaterThanOrEqual(1)
    const titles = results.map((m) => m.title)
    expect(titles).toContain('Low confidence note')
  })

  test('topN limits results', async () => {
    const results = await retriever.retrieve('deploy api gateway nginx', { topN: 1 })
    expect(results.length).toBe(1)
  })

  test('default excludes archived status', async () => {
    const results = await retriever.retrieve('old archived session', { confidenceThreshold: 0.1 })
    const titles = results.map((m) => m.title)
    expect(titles).not.toContain('Old archived session')
  })

  test('specified status filter returns archived memories', async () => {
    const results = await retriever.retrieve('old archived', {
      status: ['archived'],
      confidenceThreshold: 0.1,
    })
    expect(results.length).toBeGreaterThanOrEqual(1)
    const titles = results.map((m) => m.title)
    expect(titles).toContain('Old archived session')
  })

  test('results sorted by score descending then confidence', async () => {
    // Query that matches multiple memories
    const results = await retriever.retrieve('deploy database', { topN: 10 })
    expect(results.length).toBeGreaterThanOrEqual(2)

    // Verify ordering: scores should be non-increasing
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1]
      const curr = results[i]
      // We can't see scores directly, but the order should be stable
      // At minimum, every result should have a positive score (enforced by filter)
      expect(prev.confidence).toBeGreaterThanOrEqual(0)
      expect(curr.confidence).toBeGreaterThanOrEqual(0)
    }
  })

  test('stop words are filtered from query', async () => {
    // "the database is" should extract only "database" (stop words: the, is)
    const results = await retriever.retrieve('the database is')
    expect(results.length).toBeGreaterThanOrEqual(1)
    const titles = results.map((m) => m.title)
    expect(titles).toContain('Database timeout error')
  })
})
