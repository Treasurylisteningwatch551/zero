import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryLifecycle } from '../lifecycle'
import { MemoryStore } from '../store'

describe('MemoryLifecycle', () => {
  let tmpDir: string
  let store: MemoryStore
  let lifecycle: MemoryLifecycle

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zero-lifecycle-'))
    store = new MemoryStore(tmpDir)
    lifecycle = new MemoryLifecycle(store)
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('createSessionMemory sets title, status, and confidence', async () => {
    const mem = await lifecycle.createSessionMemory('sess-001', 'Completed deploy task', ['deploy'])

    expect(mem.title).toBe('Session sess-001')
    expect(mem.status).toBe('verified')
    expect(mem.confidence).toBe(0.8)
    expect(mem.sessionId).toBe('sess-001')
    expect(mem.tags).toContain('deploy')
    expect(mem.content).toBe('Completed deploy task')
  })

  test('createIncident prefixes tags with incident and sets draft status', async () => {
    const mem = await lifecycle.createIncident('OOM Crash', 'Process killed by OOM', 'sess-002', [
      'memory',
      'crash',
    ])

    expect(mem.title).toBe('OOM Crash')
    expect(mem.status).toBe('draft')
    expect(mem.confidence).toBe(0.7)
    expect(mem.tags[0]).toBe('incident')
    expect(mem.tags).toContain('memory')
    expect(mem.tags).toContain('crash')
    expect(mem.sessionId).toBe('sess-002')
  })

  test('verify updates status to verified with specified confidence', async () => {
    const mem = await lifecycle.createIncident('Bug', 'A bug', 'sess-003', ['bug'])
    expect(mem.status).toBe('draft')

    const verified = await lifecycle.verify('incident', mem.id, 0.95)
    expect(verified).toBeDefined()
    expect(verified!.status).toBe('verified')
    expect(verified!.confidence).toBe(0.95)
  })

  test('verify uses default confidence 0.9 when not specified', async () => {
    const mem = await lifecycle.createIncident('Issue', 'An issue', 'sess-004', ['issue'])

    const verified = await lifecycle.verify('incident', mem.id)
    expect(verified).toBeDefined()
    expect(verified!.status).toBe('verified')
    expect(verified!.confidence).toBe(0.9)
  })

  test('archiveOld archives memories older than N days', async () => {
    const archiveDir = mkdtempSync(join(tmpdir(), 'zero-lifecycle-archive-'))
    const archiveStore = new MemoryStore(archiveDir)
    const archiveLifecycle = new MemoryLifecycle(archiveStore)

    await archiveStore.create('note', 'Recent note', 'Just created', {
      status: 'verified',
      confidence: 0.8,
    })

    // Wait a small amount to ensure time gap
    await Bun.sleep(10)

    // olderThanDays=0 means cutoff = Date.now(), so anything created before now is older
    const count = await archiveLifecycle.archiveOld('note', 0)
    expect(count).toBe(1)

    const notes = archiveStore.list('note')
    expect(notes[0].status).toBe('archived')

    rmSync(archiveDir, { recursive: true, force: true })
  })

  test('archiveOld skips already archived memories', async () => {
    const archiveDir = mkdtempSync(join(tmpdir(), 'zero-lifecycle-skip-'))
    const archiveStore = new MemoryStore(archiveDir)
    const archiveLifecycle = new MemoryLifecycle(archiveStore)

    await archiveStore.create('note', 'Already archived', 'Old stuff', {
      status: 'archived',
      confidence: 0.5,
    })

    await Bun.sleep(10)

    const count = await archiveLifecycle.archiveOld('note', 0)
    expect(count).toBe(0)

    rmSync(archiveDir, { recursive: true, force: true })
  })

  test('resolveConflict archives lower confidence memory', async () => {
    const m1 = await store.create('note', 'High confidence', 'Winner content', {
      confidence: 0.9,
      status: 'verified',
    })
    const m2 = await store.create('note', 'Low confidence', 'Loser content', {
      confidence: 0.6,
      status: 'verified',
    })

    const winner = await lifecycle.resolveConflict('note', m1.id, m2.id)
    expect(winner).toBeDefined()
    expect(winner!.id).toBe(m1.id)
    expect(winner!.related).toContain(m2.id)

    const loser = store.get('note', m2.id)
    expect(loser).toBeDefined()
    expect(loser!.status).toBe('archived')
  })

  test('resolveConflict with same confidence picks more recently updated', async () => {
    const m1 = await store.create('note', 'Older note', 'Created first', {
      confidence: 0.8,
      status: 'verified',
    })

    // Wait to ensure different updatedAt timestamps
    await Bun.sleep(10)

    const m2 = await store.create('note', 'Newer note', 'Created second', {
      confidence: 0.8,
      status: 'verified',
    })

    const winner = await lifecycle.resolveConflict('note', m1.id, m2.id)
    expect(winner).toBeDefined()
    expect(winner!.id).toBe(m2.id)
    expect(winner!.related).toContain(m1.id)

    const loser = store.get('note', m1.id)
    expect(loser).toBeDefined()
    expect(loser!.status).toBe('archived')
  })
})
