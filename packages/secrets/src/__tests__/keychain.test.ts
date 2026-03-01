import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { setMasterKey, getMasterKey, deleteMasterKey, generateMasterKey } from '../keychain'

describe('macOS Keychain integration', () => {
  const testKey = generateMasterKey()
  let originalKey: Buffer | null = null

  beforeAll(async () => {
    try {
      originalKey = await getMasterKey()
    } catch {
      originalKey = null
    }
  })

  afterAll(async () => {
    // Restore original key if it existed, otherwise clean up
    if (originalKey) {
      await setMasterKey(originalKey)
    } else {
      await deleteMasterKey()
    }
  })

  test('set and get master key round-trip', async () => {
    await setMasterKey(testKey)
    const retrieved = await getMasterKey()
    expect(retrieved).toEqual(testKey)
  })

  test('delete removes the key', async () => {
    await setMasterKey(testKey)
    await deleteMasterKey()
    await expect(getMasterKey()).rejects.toThrow('Master key not found')
  })

  test('generateMasterKey produces 32-byte key', () => {
    const key = generateMasterKey()
    expect(key.length).toBe(32)
  })

  test('generateMasterKey produces unique keys', () => {
    const key1 = generateMasterKey()
    const key2 = generateMasterKey()
    expect(key1).not.toEqual(key2)
  })
})
