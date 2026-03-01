import { describe, test, expect, afterAll } from 'bun:test'
import { MemoryStore } from '../store'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const testDir = join(import.meta.dir, '__fixtures__/memory')

describe('MemoryStore', () => {
  afterAll(() => {
    rmSync(join(import.meta.dir, '__fixtures__'), { recursive: true, force: true })
  })

  test('create and get memory', () => {
    mkdirSync(testDir, { recursive: true })
    const store = new MemoryStore(testDir)

    const mem = store.create('note', 'Test Note', 'This is a test note.', {
      tags: ['test', 'note'],
      confidence: 0.9,
    })

    expect(mem.id).toMatch(/^mem_/)
    expect(mem.type).toBe('note')
    expect(mem.title).toBe('Test Note')
    expect(mem.content).toBe('This is a test note.')
    expect(mem.tags).toContain('test')

    // Read it back
    const retrieved = store.get('note', mem.id)
    expect(retrieved).toBeDefined()
    expect(retrieved!.title).toBe('Test Note')
    expect(retrieved!.content).toBe('This is a test note.')
  })

  test('list memories by type', () => {
    const store = new MemoryStore(testDir)

    store.create('incident', 'Incident 1', 'First incident')
    store.create('incident', 'Incident 2', 'Second incident')
    store.create('note', 'Note 1', 'A note')

    const incidents = store.list('incident')
    expect(incidents.length).toBeGreaterThanOrEqual(2)

    const notes = store.list('note')
    expect(notes.length).toBeGreaterThanOrEqual(1)
  })

  test('update memory', () => {
    const store = new MemoryStore(testDir)
    const mem = store.create('decision', 'Test Decision', 'Original content')

    const updated = store.update('decision', mem.id, {
      content: 'Updated content',
      status: 'verified',
      confidence: 0.95,
    })

    expect(updated).toBeDefined()
    expect(updated!.content).toBe('Updated content')
    expect(updated!.status).toBe('verified')
    expect(updated!.confidence).toBe(0.95)
  })

  test('delete memory', () => {
    const store = new MemoryStore(testDir)
    const mem = store.create('note', 'To Delete', 'Will be deleted')

    expect(store.delete('note', mem.id)).toBe(true)
    expect(store.get('note', mem.id)).toBeUndefined()
    expect(store.delete('note', mem.id)).toBe(false)
  })

  test('searchByTags finds matching memories', () => {
    const store = new MemoryStore(testDir)
    store.create('runbook', 'Deploy Process', 'Steps to deploy', {
      tags: ['deploy', 'ops'],
    })
    store.create('runbook', 'Backup Process', 'Steps to backup', {
      tags: ['backup', 'ops'],
    })

    const results = store.searchByTags(['deploy'])
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].tags).toContain('deploy')
  })
})
