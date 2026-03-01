import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

export interface SecretStore {
  [key: string]: string
}

/**
 * Encrypt a secrets store object and write to file.
 */
export function encryptSecrets(secrets: SecretStore, masterKey: Buffer, filePath: string): void {
  const plaintext = JSON.stringify(secrets)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, masterKey, iv)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Format: [iv (16 bytes)] [authTag (16 bytes)] [encrypted data]
  const output = Buffer.concat([iv, authTag, encrypted])
  writeFileSync(filePath, output)
}

/**
 * Read and decrypt a secrets file.
 */
export function decryptSecrets(masterKey: Buffer, filePath: string): SecretStore {
  if (!existsSync(filePath)) {
    return {}
  }

  const data = readFileSync(filePath)
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid secrets file: too short')
  }

  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, masterKey, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf-8'))
}

/**
 * In-memory vault that manages the secret store lifecycle.
 */
export class Vault {
  private secrets: SecretStore = {}
  private filePath: string
  private masterKey: Buffer

  constructor(masterKey: Buffer, filePath: string) {
    this.masterKey = masterKey
    this.filePath = filePath
  }

  /**
   * Load secrets from encrypted file into memory.
   */
  load(): void {
    this.secrets = decryptSecrets(this.masterKey, this.filePath)
  }

  /**
   * Persist current in-memory secrets to encrypted file.
   */
  save(): void {
    encryptSecrets(this.secrets, this.masterKey, this.filePath)
  }

  /**
   * Get a secret value by key.
   */
  get(key: string): string | undefined {
    return this.secrets[key]
  }

  /**
   * Set a secret value.
   */
  set(key: string, value: string): void {
    this.secrets[key] = value
    this.save()
  }

  /**
   * Delete a secret.
   */
  delete(key: string): void {
    delete this.secrets[key]
    this.save()
  }

  /**
   * List all secret keys (values are never exposed).
   */
  keys(): string[] {
    return Object.keys(this.secrets)
  }

  /**
   * Get all secret key-value pairs (for SecretFilter initialization).
   */
  entries(): [string, string][] {
    return Object.entries(this.secrets)
  }
}
