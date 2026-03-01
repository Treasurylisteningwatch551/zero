import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const HEARTBEAT_INTERVAL = 10_000 // 10 seconds
const STALE_THRESHOLD = 50_000 // 50 seconds

/**
 * Heartbeat writer — called by the main process.
 */
export class HeartbeatWriter {
  private filePath: string
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(filePath: string) {
    this.filePath = filePath
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Start writing heartbeats at the configured interval.
   */
  start(): void {
    this.write()
    this.timer = setInterval(() => this.write(), HEARTBEAT_INTERVAL)
  }

  /**
   * Stop writing heartbeats.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Write a single heartbeat.
   */
  write(): void {
    const data = {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
    }
    writeFileSync(this.filePath, JSON.stringify(data), 'utf-8')
  }
}

/**
 * Heartbeat checker — called by the supervisor process.
 */
export class HeartbeatChecker {
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  /**
   * Check if the main process is alive.
   */
  check(): { alive: boolean; lastBeat?: Date; elapsedMs?: number; pid?: number } {
    if (!existsSync(this.filePath)) {
      return { alive: false }
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw) as { timestamp: string; pid: number }
      const lastBeat = new Date(data.timestamp)
      const elapsedMs = Date.now() - lastBeat.getTime()

      return {
        alive: elapsedMs < STALE_THRESHOLD,
        lastBeat,
        elapsedMs,
        pid: data.pid,
      }
    } catch {
      return { alive: false }
    }
  }
}
