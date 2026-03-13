import { afterAll, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Vault, decryptSecrets, encryptSecrets } from '../vault'

const testDir = join(import.meta.dir, '__fixtures__')
const testKey = randomBytes(32)

describe('Vault encryption', () => {
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('encrypt and decrypt round-trip', () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'secrets.enc')
    const secrets = {
      openai_api_key: 'sk-test-123456',
      anthropic_api_key: 'sk-ant-test-789',
    }

    encryptSecrets(secrets, testKey, filePath)
    const decrypted = decryptSecrets(testKey, filePath)
    expect(decrypted).toEqual(secrets)
  })

  test('decrypt returns empty object for missing file', () => {
    const result = decryptSecrets(testKey, '/nonexistent/secrets.enc')
    expect(result).toEqual({})
  })

  test('decrypt fails with wrong key', () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'secrets-wrong-key.enc')
    encryptSecrets({ key: 'value' }, testKey, filePath)

    const wrongKey = randomBytes(32)
    expect(() => decryptSecrets(wrongKey, filePath)).toThrow()
  })
})

describe('Vault class', () => {
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('set, get, delete, keys operations', () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'vault-ops.enc')
    const vault = new Vault(testKey, filePath)

    vault.set('api_key', 'sk-test-abc')
    expect(vault.get('api_key')).toBe('sk-test-abc')
    expect(vault.keys()).toEqual(['api_key'])

    vault.set('another_key', 'value-xyz')
    expect(vault.keys()).toHaveLength(2)

    vault.delete('api_key')
    expect(vault.get('api_key')).toBeUndefined()
    expect(vault.keys()).toEqual(['another_key'])
  })

  test('persistence across instances', () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'vault-persist.enc')

    const vault1 = new Vault(testKey, filePath)
    vault1.set('persistent_key', 'persistent_value')

    const vault2 = new Vault(testKey, filePath)
    vault2.load()
    expect(vault2.get('persistent_key')).toBe('persistent_value')
  })
})
