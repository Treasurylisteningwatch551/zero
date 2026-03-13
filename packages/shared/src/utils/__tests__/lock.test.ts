import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireLock, isLocked, withLock } from '../lock'

const testDir = join(import.meta.dir, '__fixtures__')

describe('File lock utilities', () => {
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('acquireLock and release', async () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'lock-test.txt')
    writeFileSync(filePath, 'test', 'utf-8')

    const release = await acquireLock(filePath)
    expect(await isLocked(filePath)).toBe(true)

    await release()
    expect(await isLocked(filePath)).toBe(false)
  })

  test('withLock executes function and releases', async () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'withlock-test.txt')
    writeFileSync(filePath, 'test', 'utf-8')

    const result = await withLock(filePath, async () => {
      expect(await isLocked(filePath)).toBe(true)
      return 42
    })

    expect(result).toBe(42)
    expect(await isLocked(filePath)).toBe(false)
  })

  test('acquireLock creates file if missing', async () => {
    const filePath = join(testDir, 'auto-created.txt')
    const release = await acquireLock(filePath)
    await release()
    expect(Bun.file(filePath).size).toBe(0)
  })
})
