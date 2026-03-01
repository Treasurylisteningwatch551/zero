import parser from 'cron-parser'
import type { ScheduleConfig } from '@zero-os/shared'

export interface ScheduleEntry {
  config: ScheduleConfig
  nextRun: Date
  lastRun?: Date
  running: boolean
}

/**
 * Cron scheduler — manages timed task execution.
 */
export class CronScheduler {
  private entries: Map<string, ScheduleEntry> = new Map()
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private onTrigger: ((config: ScheduleConfig) => Promise<void>) | null = null

  /**
   * Set the trigger handler called when a schedule fires.
   */
  setTriggerHandler(handler: (config: ScheduleConfig) => Promise<void>): void {
    this.onTrigger = handler
  }

  /**
   * Add a schedule.
   */
  add(config: ScheduleConfig): void {
    const interval = parser.parseExpression(config.cron)
    const nextRun = interval.next().toDate()

    this.entries.set(config.name, {
      config,
      nextRun,
      running: false,
    })
  }

  /**
   * Start all schedules.
   */
  start(): void {
    for (const [name, entry] of this.entries) {
      this.scheduleNext(name, entry)
    }
  }

  /**
   * Stop all schedules.
   */
  stop(): void {
    for (const [name, timer] of this.timers) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  /**
   * Get the status of all schedules.
   */
  getStatus(): { name: string; nextRun: Date; running: boolean; lastRun?: Date }[] {
    return Array.from(this.entries.values()).map((e) => ({
      name: e.config.name,
      nextRun: e.nextRun,
      running: e.running,
      lastRun: e.lastRun,
    }))
  }

  /**
   * Parse a cron expression and return the next N execution times.
   */
  static getNextRuns(cronExpr: string, count: number = 5): Date[] {
    const interval = parser.parseExpression(cronExpr)
    const dates: Date[] = []
    for (let i = 0; i < count; i++) {
      dates.push(interval.next().toDate())
    }
    return dates
  }

  private scheduleNext(name: string, entry: ScheduleEntry): void {
    const delay = entry.nextRun.getTime() - Date.now()
    if (delay < 0) {
      // Missed execution — check misfire policy
      const policy = entry.config.misfirePolicy ?? 'skip'
      if (policy === 'run_once') {
        this.fire(name, entry)
      }
      // Calculate next run
      const interval = parser.parseExpression(entry.config.cron)
      entry.nextRun = interval.next().toDate()
      this.scheduleNext(name, entry)
      return
    }

    const timer = setTimeout(() => {
      this.fire(name, entry)
    }, delay)

    this.timers.set(name, timer)
  }

  private async fire(name: string, entry: ScheduleEntry): Promise<void> {
    // Check overlap policy
    const policy = entry.config.overlapPolicy?.type ?? 'skip'
    if (entry.running && policy === 'skip') {
      return
    }

    entry.running = true
    entry.lastRun = new Date()

    try {
      if (this.onTrigger) {
        await this.onTrigger(entry.config)
      }
    } finally {
      entry.running = false

      // Schedule next run
      const interval = parser.parseExpression(entry.config.cron)
      entry.nextRun = interval.next().toDate()
      this.scheduleNext(name, entry)
    }
  }
}
