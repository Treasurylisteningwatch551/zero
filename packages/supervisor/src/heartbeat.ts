import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const HEARTBEAT_INTERVAL = 3_000 // 3 seconds
const STALE_THRESHOLD = 10_000 // 10 seconds
const ERROR_THRESHOLD_UNHEALTHY = 10
const ERROR_THRESHOLD_DEGRADED = 3
const READY_WAIT_TIMEOUT_MS = 300_000
const READY_POLL_INTERVAL_MS = 1_000

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface ChannelHealthMetrics {
  name: string
  type: string
  connected: boolean
  configured: boolean
}

export interface HealthMetrics {
  errorCount: number
  channels: ChannelHealthMetrics[]
}

export interface HeartbeatData {
  timestamp: string
  pid: number
  uptime: number
  ready: boolean
  stage: string
  health: {
    memoryUsageMB: number
    errorCount: number
    status: HealthStatus
    channels: {
      total: number
      configured: number
      connected: number
      disconnected: number
      offline: string[]
    }
  }
  channels: ChannelHealthMetrics[]
}

/**
 * Heartbeat writer — called by the main process.
 */
export class HeartbeatWriter {
  private filePath: string
  private timer: ReturnType<typeof setInterval> | null = null
  private healthMetrics: HealthMetrics = { errorCount: 0, channels: [] }
  private metricsProvider: (() => Partial<HealthMetrics>) | null = null
  private onWrite: ((data: HeartbeatData) => void) | null = null
  private lastHeartbeat: HeartbeatData | null = null
  private ready = false
  private stage = 'booting'

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
  setHealthMetrics(metrics: Partial<HealthMetrics>): void {
    this.healthMetrics = {
      ...this.healthMetrics,
      ...metrics,
      channels: metrics.channels ?? this.healthMetrics.channels,
    }
  }

  /**
   * Register a callback that can provide live metrics right before each write.
   */
  setHealthMetricsProvider(provider: (() => Partial<HealthMetrics>) | null): void {
    this.metricsProvider = provider
  }

  /**
   * Register a callback fired after each heartbeat write.
   */
  setOnWrite(callback: ((data: HeartbeatData) => void) | null): void {
    this.onWrite = callback
  }

  /**
   * Return the latest heartbeat snapshot written by this process.
   */
  getLastHeartbeat(): HeartbeatData | null {
    return this.lastHeartbeat
  }

  /**
   * Update runtime readiness state.
   */
  setReady(ready: boolean, stage = ready ? 'ready' : this.stage): void {
    this.ready = ready
    this.stage = stage
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
    const liveMetrics = this.metricsProvider?.() ?? {}
    const channels = liveMetrics.channels ?? this.healthMetrics.channels
    const errorCount = liveMetrics.errorCount ?? this.healthMetrics.errorCount
    const configuredChannels = channels.filter((channel) => channel.configured)
    const offlineChannels = configuredChannels
      .filter((channel) => !channel.connected)
      .map((channel) => channel.name)
    let status: HealthStatus = 'healthy'
    if (errorCount >= ERROR_THRESHOLD_UNHEALTHY) {
      status = 'unhealthy'
    } else if (errorCount >= ERROR_THRESHOLD_DEGRADED || offlineChannels.length > 0) {
      status = 'degraded'
    }

    const data: HeartbeatData = {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
      ready: this.ready,
      stage: this.stage,
      health: {
        memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        errorCount,
        status,
        channels: {
          total: channels.length,
          configured: configuredChannels.length,
          connected: configuredChannels.filter((channel) => channel.connected).length,
          disconnected: offlineChannels.length,
          offline: offlineChannels,
        },
      },
      channels,
    }

    this.lastHeartbeat = data
    writeFileSync(this.filePath, JSON.stringify(data), 'utf-8')
    this.onWrite?.(data)
  }
}

export interface HeartbeatCheckResult {
  alive: boolean
  lastBeat?: Date
  elapsedMs?: number
  pid?: number
  ready?: boolean
  stage?: string
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
        ready: data.ready,
        stage: data.stage,
        health: data.health,
      }
    } catch {
      return { alive: false }
    }
  }
}

export async function waitForHeartbeatReady(
  checker: HeartbeatChecker,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? READY_WAIT_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? READY_POLL_INTERVAL_MS
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const result = checker.check()
    if (result.alive && result.ready) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  return false
}
