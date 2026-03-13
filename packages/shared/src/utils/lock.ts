import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import lockfile from 'proper-lockfile'

/**
 * Acquire a file lock. Returns a release function.
 */
export async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  ensureFileExists(filePath)
  const release = await lockfile.lock(filePath, {
    retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
    stale: 10_000,
  })
  return release
}

/**
 * Execute a function with a file lock held.
 */
export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock(filePath)
  try {
    return await fn()
  } finally {
    await release()
  }
}

/**
 * Check if a file is currently locked.
 */
export async function isLocked(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false
  return lockfile.check(filePath)
}

function ensureFileExists(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '', 'utf-8')
  }
}
