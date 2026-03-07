import { spawnSync } from 'node:child_process'

export interface WebBuildResult {
  ok: boolean
  error?: string
}

export function rebuildWebBundle(): WebBuildResult {
  const result = spawnSync('bun', ['run', 'build:web'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  if (result.status === 0) {
    return { ok: true }
  }

  return {
    ok: false,
    error: result.error?.message ?? `build:web exited with code ${result.status ?? 'unknown'}`,
  }
}
