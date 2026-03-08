import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { getBunExecutable, getRuntimeEnv } from './runtime'

export interface WebBuildResult {
  ok: boolean
  error?: string
}

export function rebuildWebBundle(): WebBuildResult {
  const result = spawnSync(getBunExecutable(), ['run', 'build'], {
    cwd: join(process.cwd(), 'apps/web'),
    env: getRuntimeEnv(),
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
