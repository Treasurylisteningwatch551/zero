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
  private onRemoved: ((name: string) => void) | null = null
  private queued: Map<string, ScheduleConfig[]> = new Map()
  private runningAbort: Map<string, AbortController> = new Map()

  /**
   * Set the trigger handler called when a schedule fires.
   */
  setTriggerHandler(handler: (config: ScheduleConfig) => Promise<void>): void {
    this.onTrigger = handler
  }

  /**
   * Set a callback invoked when a schedule is removed (e.g. oneShot cleanup).
   */
  setOnRemoved(handler: (name: string) => void): void {
    this.onRemoved = handler
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
   * Add a schedule and immediately start its timer.
   * Use this when the scheduler is already running.
   */
  addAndStart(config: ScheduleConfig): void {
    this.add(config)
    const entry = this.entries.get(config.name)
    if (entry) {
      this.scheduleNext(config.name, entry)
    }
  }

  /**
   * Remove a schedule by name. Returns true if it existed.
   */
  remove(name: string): boolean {
    const timer = this.timers.get(name)
    if (timer) clearTimeout(timer)
    this.timers.delete(name)
    this.queued.delete(name)
    const abort = this.runningAbort.get(name)
    if (abort) abort.abort()
    this.runningAbort.delete(name)
    return this.entries.delete(name)
  }

  /**
   * Get a single schedule entry.
   */
  getEntry(name: string): ScheduleEntry | undefined {
    return this.entries.get(name)
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
    const policy = entry.config.overlapPolicy?.type ?? 'skip'

    if (entry.running) {
      switch (policy) {
        case 'skip':
          // Skip this execution
          break
        case 'queue':
          // Queue for later execution
          if (!this.queued.has(name)) {
            this.queued.set(name, [])
          }
          this.queued.get(name)!.push(entry.config)
          break
        case 'replace':
          // Abort the running execution (signal via abort controller), then re-run
          const controller = this.runningAbort.get(name)
          if (controller) {
            controller.abort()
          }
          // Wait a tick for the abort to propagate, then fall through to execute
          await new Promise((r) => setTimeout(r, 10))
          break
      }

      if (policy !== 'replace') {
        // Schedule next run
        const interval = parser.parseExpression(entry.config.cron)
        entry.nextRun = interval.next().toDate()
        this.scheduleNext(name, entry)
        return
      }
    }

    entry.running = true
    entry.lastRun = new Date()

    const abortController = new AbortController()
    this.runningAbort.set(name, abortController)

    try {
      if (this.onTrigger) {
        await this.onTrigger(entry.config)
      }
    } finally {
      entry.running = false
      this.runningAbort.delete(name)

      // oneShot: remove after single execution
      if (entry.config.oneShot) {
        this.remove(name)
        if (this.onRemoved) {
          this.onRemoved(name)
        }
        return
      }

      // Process queued executions
      const queue = this.queued.get(name)
      if (queue && queue.length > 0) {
        queue.shift()
        if (queue.length > 0) {
          // Re-fire immediately for queued item
          this.fire(name, entry)
          return
        }
      }

      // Schedule next run
      const interval = parser.parseExpression(entry.config.cron)
      entry.nextRun = interval.next().toDate()
      this.scheduleNext(name, entry)
    }
  }
}
