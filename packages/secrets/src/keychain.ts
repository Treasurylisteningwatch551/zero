const SERVICE = 'com.zero-os.vault'
const ACCOUNT = 'master-key'

/**
 * Read the master key from macOS Keychain.
 */
export async function getMasterKey(): Promise<Buffer> {
  const proc = Bun.spawn(
    ['security', 'find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Master key not found in Keychain (service: ${SERVICE})`)
  }
  const stdout = await new Response(proc.stdout).text()
  return Buffer.from(stdout.trim(), 'base64')
}

/**
 * Store the master key in macOS Keychain.
 * Uses -U flag to update if already exists.
 */
export async function setMasterKey(key: Buffer): Promise<void> {
  const encoded = key.toString('base64')
  // First try to delete existing entry (ignore errors)
  const del = Bun.spawn(
    ['security', 'delete-generic-password', '-s', SERVICE, '-a', ACCOUNT],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  await del.exited

  // Then add the new key
  const proc = Bun.spawn(
    ['security', 'add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', encoded],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`Failed to store master key in Keychain: ${stderr}`)
  }
}

/**
 * Delete the master key from macOS Keychain.
 */
export async function deleteMasterKey(): Promise<void> {
  const proc = Bun.spawn(
    ['security', 'delete-generic-password', '-s', SERVICE, '-a', ACCOUNT],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  await proc.exited
}

/**
 * Generate a new random 256-bit master key.
 */
export function generateMasterKey(): Buffer {
  const { randomBytes } = require('node:crypto')
  return randomBytes(32)
}
