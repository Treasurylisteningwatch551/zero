import { join } from 'node:path'
import { HeartbeatChecker } from '@zero-os/supervisor'
import { RepairEngine } from '@zero-os/supervisor'

const PROJECT_ROOT = join(import.meta.dirname, '..', '..', '..')
const ZERO_DIR = join(PROJECT_ROOT, '.zero')
const HEARTBEAT_FILE = join(ZERO_DIR, 'heartbeat.json')
const CHECK_INTERVAL = 5_000 // 5 seconds
const LOG_INTERVAL = 60_000 // log alive status every 60 seconds

const checker = new HeartbeatChecker(HEARTBEAT_FILE)
const repairEngine = new RepairEngine()
let lastAliveLogAt = 0

console.log('[Supervisor] Starting heartbeat monitor...')
console.log(`[Supervisor] Checking: ${HEARTBEAT_FILE}`)
console.log(`[Supervisor] Interval: ${CHECK_INTERVAL / 1000}s`)

setInterval(async () => {
  const result = checker.check()

  if (result.alive) {
    const now = Date.now()
    if (now - lastAliveLogAt >= LOG_INTERVAL) {
      lastAliveLogAt = now
      const healthInfo = result.health
        ? ` | health: ${result.health.status}, mem: ${result.health.memoryUsageMB}MB, errors: ${result.health.errorCount}`
        : ''
      console.log(
        `[Supervisor] Main process alive (PID: ${result.pid}, last beat: ${result.elapsedMs}ms ago${healthInfo})`
      )
    }
  } else {
    console.warn('[Supervisor] Main process appears dead!')
    console.warn(`[Supervisor] Last heartbeat: ${result.lastBeat?.toISOString() ?? 'never'}`)

    if (repairEngine.shouldFuse()) {
      console.error('[Supervisor] Max repair attempts reached — fusing. Manual intervention required.')
      return
    }

    const attempt = await repairEngine.runRepairCycle(
      async () => {
        // Diagnose: check heartbeat staleness
        const info = checker.check()
        return info.alive
          ? 'Process recovered during diagnosis'
          : `Process dead. Last heartbeat: ${info.lastBeat?.toISOString() ?? 'never'}, elapsed: ${info.elapsedMs ?? 'unknown'}ms`
      },
      async (diagnosis) => {
        // Repair: attempt to restart the main process
        console.log(`[Supervisor] Diagnosis: ${diagnosis}`)
        console.log('[Supervisor] Attempting restart via Bun...')
        const proc = Bun.spawn(['bun', 'run', join(PROJECT_ROOT, 'apps/server/src/cli.ts'), 'start'], {
          cwd: PROJECT_ROOT,
          stdout: 'inherit',
          stderr: 'inherit',
        })
        return `Started new process PID: ${proc.pid}`
      },
      async () => {
        // Verify: wait and check heartbeat again
        await new Promise((resolve) => setTimeout(resolve, 8_000))
        const verifyResult = checker.check()
        return verifyResult.alive
      }
    )

    console.log(`[Supervisor] Repair attempt: ${attempt.status} — ${attempt.result}`)
  }
}, CHECK_INTERVAL)
