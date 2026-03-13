import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const HEARTBEAT_INTERVAL = 3_000 // 3 seconds
const STALE_THRESHOLD = 10_000 // 10 seconds
const ERROR_THRESHOLD_UNHEALTHY = 10
const ERROR_THRESHOLD_DEGRADED = 3

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthMetrics {
  errorCount: number
}

export interface HeartbeatData {
  timestamp: string
  pid: number
  uptime: number
  health: {
    memoryUsageMB: number
    errorCount: number
    status: HealthStatus
  }
}

/**
 * Heartbeat writer — called by the main process.
 */
export class HeartbeatWriter {
  private filePath: string
  private timer: ReturnType<typeof setInterval> | null = null
  private healthMetrics: HealthMetrics = { errorCount: 0 }

  constructor(filePath: string) {
    this.filePath = filePath
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Update health metrics from the main process.
   */
  setHealthMetrics(metrics: HealthMetrics): void {
    this.healthMetrics = metrics
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
    const errorCount = this.healthMetrics.errorCount
    let status: HealthStatus = 'healthy'
    if (errorCount >= ERROR_THRESHOLD_UNHEALTHY) {
      status = 'unhealthy'
    } else if (errorCount >= ERROR_THRESHOLD_DEGRADED) {
      status = 'degraded'
    }

    const data: HeartbeatData = {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
      health: {
        memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        errorCount,
        status,
      },
    }
    writeFileSync(this.filePath, JSON.stringify(data), 'utf-8')
  }
}

export interface HeartbeatCheckResult {
  alive: boolean
  lastBeat?: Date
  elapsedMs?: number
  pid?: number
  health?: HeartbeatData['health']
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
  check(): HeartbeatCheckResult {
    if (!existsSync(this.filePath)) {
      return { alive: false }
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw) as HeartbeatData
      const lastBeat = new Date(data.timestamp)
      const elapsedMs = Date.now() - lastBeat.getTime()

      return {
        alive: elapsedMs < STALE_THRESHOLD,
        lastBeat,
        elapsedMs,
        pid: data.pid,
        health: data.health,
      }
    } catch {
      return { alive: false }
    }
  }
}
