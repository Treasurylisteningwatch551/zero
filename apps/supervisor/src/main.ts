import { join } from 'node:path'
import { HeartbeatChecker } from '@zero-os/supervisor'

const ZERO_DIR = join(process.cwd(), '.zero')
const HEARTBEAT_FILE = join(ZERO_DIR, 'heartbeat.json')
const CHECK_INTERVAL = 20_000 // 20 seconds

const checker = new HeartbeatChecker(HEARTBEAT_FILE)

console.log('[Supervisor] Starting heartbeat monitor...')
console.log(`[Supervisor] Checking: ${HEARTBEAT_FILE}`)
console.log(`[Supervisor] Interval: ${CHECK_INTERVAL / 1000}s`)

setInterval(() => {
  const result = checker.check()

  if (result.alive) {
    console.log(
      `[Supervisor] Main process alive (PID: ${result.pid}, last beat: ${result.elapsedMs}ms ago)`
    )
  } else {
    console.warn('[Supervisor] Main process appears dead!')
    console.warn(`[Supervisor] Last heartbeat: ${result.lastBeat?.toISOString() ?? 'never'}`)
    // TODO: Trigger repair cycle
  }
}, CHECK_INTERVAL)
