import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryStore } from '../store'
import { MemoryLifecycle } from '../lifecycle'
import { MemoryRetriever } from '../retrieval'

let tmpDir: string
let store: MemoryStore
let lifecycle: MemoryLifecycle
let retriever: MemoryRetriever

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'zero-retrieval-int-'))
  store = new MemoryStore(tmpDir)
  lifecycle = new MemoryLifecycle(store)
  retriever = new MemoryRetriever(store)
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('Memory Pipeline: Store → Lifecycle → Retrieval', () => {
  test('lifecycle creates session memory → retriever finds it', async () => {
    lifecycle.createSessionMemory('sess-001', 'Deployed API gateway successfully', ['deploy', 'api'])

    const results = await retriever.retrieve('deploy api', { topN: 10 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain('Session sess-001')
    expect(results[0].content).toContain('Deployed API gateway')
  })

  test('lifecycle creates incident → retriever finds by tag after verification', async () => {
    const mem = lifecycle.createIncident('Database timeout', 'Connection pool exhausted', 'sess-002', ['database', 'timeout'])
    // Incidents start as draft; verify before retrieval (only verified memories are retrievable)
    lifecycle.verify('incident', mem.id)

    const results = await retriever.retrieve('database', { tags: ['incident'] })
    expect(results.length).toBeGreaterThan(0)
    const incident = results.find((m) => m.title === 'Database timeout')
    expect(incident).toBeDefined()
    expect(incident!.tags).toContain('incident')
  })

  test('lifecycle archives → retriever excludes by default', async () => {
    const mem = lifecycle.createSessionMemory('sess-003', 'Old session data', ['old'])
    store.update('session', mem.id, { status: 'archived' })

    const results = await retriever.retrieve('old session', { topN: 20 })
    const archivedFound = results.find((m) => m.id === mem.id)
    expect(archivedFound).toBeUndefined()
  })

  test('lifecycle conflict resolution → retriever returns winner only', async () => {
    const m1 = store.create('note', 'Conflicting note A', 'First version', {
      tags: ['conflict-test'], status: 'verified', confidence: 0.9,
    })
    const m2 = store.create('note', 'Conflicting note B', 'Second version', {
      tags: ['conflict-test'], status: 'verified', confidence: 0.6,
    })

    lifecycle.resolveConflict('note', m1.id, m2.id)

    const results = await retriever.retrieve('conflict-test version', {
      tags: ['conflict-test'], topN: 10,
    })
    // Winner (higher confidence) should be present, loser archived
    const ids = results.map((m) => m.id)
    expect(ids).toContain(m1.id)
    expect(ids).not.toContain(m2.id)
  })

  test('only verified memories are returned by default (drafts excluded)', async () => {
    store.create('note', 'Draft ranking note', 'Some ranking content', {
      tags: ['ranking'], status: 'draft', confidence: 0.7,
    })
    store.create('note', 'Verified ranking note', 'Some ranking content', {
      tags: ['ranking'], status: 'verified', confidence: 0.9,
    })

    const results = await retriever.retrieve('ranking', { tags: ['ranking'], topN: 5 })
    // Only verified memory should be returned; draft is excluded
    expect(results.length).toBe(1)
    expect(results[0].status).toBe('verified')
    expect(results[0].confidence).toBe(0.9)
  })
})
