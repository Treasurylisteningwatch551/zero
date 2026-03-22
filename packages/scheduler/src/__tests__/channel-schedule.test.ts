import { describe, expect, test } from 'bun:test'
import { CronScheduler, type ScheduleEntry } from '../cron'

const waitForTick = () => new Promise((resolve) => setTimeout(resolve, 0))

type TestableCronScheduler = {
  fire(name: string, entry: ScheduleEntry): Promise<void>
  launchFire(name: string, entry: ScheduleEntry): void
}

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined()
  if (value == null) {
    throw new Error('Expected value to be defined')
  }
  return value
}

describe('CronScheduler — new methods', () => {
  test('remove() deletes a schedule and returns true', () => {
    const scheduler = new CronScheduler()
    scheduler.add({ name: 'job1', cron: '0 2 * * *', instruction: 'test' })
    expect(scheduler.getStatus()).toHaveLength(1)

    const removed = scheduler.remove('job1')
    expect(removed).toBe(true)
    expect(scheduler.getStatus()).toHaveLength(0)
  })

  test('remove() returns false for non-existent schedule', () => {
    const scheduler = new CronScheduler()
    expect(scheduler.remove('nonexistent')).toBe(false)
  })

  test('addAndStart() adds and schedules immediately', () => {
    const scheduler = new CronScheduler()
    scheduler.start() // start with no entries

    scheduler.addAndStart({ name: 'late_add', cron: '0 3 * * *', instruction: 'added late' })

    const status = scheduler.getStatus()
    expect(status).toHaveLength(1)
    expect(status[0].name).toBe('late_add')
    expect(status[0].nextRun).toBeInstanceOf(Date)

    scheduler.stop()
  })

  test('getEntry() returns the entry for a known schedule', () => {
    const scheduler = new CronScheduler()
    scheduler.add({ name: 'entry_test', cron: '0 8 * * *', instruction: 'check' })

    const entry = expectDefined(scheduler.getEntry('entry_test'))
    expect(entry.config.name).toBe('entry_test')
    expect(entry.running).toBe(false)
  })

  test('getEntry() returns undefined for unknown schedule', () => {
    const scheduler = new CronScheduler()
    expect(scheduler.getEntry('nope')).toBeUndefined()
  })

  test('schedule with channel binding preserves channel info', () => {
    const scheduler = new CronScheduler()
    scheduler.add({
      name: 'bound_job',
      cron: '0 9 * * *',
      instruction: 'remind user',
      channel: {
        source: 'feishu',
        channelName: 'feishu',
        channelId: 'oc_abc123',
      },
      oneShot: true,
      createdBy: 'runtime',
    })

    const entry = expectDefined(scheduler.getEntry('bound_job'))
    expect(entry.config.channel).toEqual({
      source: 'feishu',
      channelName: 'feishu',
      channelId: 'oc_abc123',
    })
    expect(entry.config.oneShot).toBe(true)
    expect(entry.config.createdBy).toBe('runtime')
  })

  test('oneShot schedule fires once and auto-removes', async () => {
    const scheduler = new CronScheduler()
    let triggerCount = 0
    let removedName = ''

    scheduler.setTriggerHandler(async () => {
      triggerCount++
    })
    scheduler.setOnRemoved((name) => {
      removedName = name
    })

    scheduler.add({
      name: 'oneshot_test',
      cron: '*/5 * * * *',
      instruction: 'fire once',
      oneShot: true,
      misfirePolicy: 'run_once',
    })

    const entry = expectDefined(scheduler.getEntry('oneshot_test'))
    entry.nextRun = new Date(Date.now() - 1_000)

    // Starting the scheduler should treat the past-due nextRun as a misfire.
    scheduler.start()

    // Give it a tick to process
    await new Promise((r) => setTimeout(r, 50))

    expect(triggerCount).toBe(1)
    expect(removedName).toBe('oneshot_test')
    expect(scheduler.getEntry('oneshot_test')).toBeUndefined()
    expect(scheduler.getStatus()).toHaveLength(0)

    scheduler.stop()
  })

  test('far-future schedules cap timer delay to the runtime maximum', () => {
    const scheduler = new CronScheduler()
    const originalSetTimeout = globalThis.setTimeout
    const scheduledDelays: number[] = []

    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      scheduledDelays.push(timeout ?? 0)
      return originalSetTimeout(handler, 0, ...args)
    }) as typeof setTimeout

    try {
      scheduler.add({
        name: 'future_job',
        cron: '0 0 1 1 *',
        instruction: 'future run',
      })

      scheduler.start()

      expect(scheduledDelays.length).toBeGreaterThan(0)
      expect(scheduledDelays[0]).toBe(2_147_483_647)
    } finally {
      scheduler.stop()
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test('remove() clears timer for running schedule', () => {
    const scheduler = new CronScheduler()
    scheduler.add({ name: 'timed', cron: '*/1 * * * *', instruction: 'test' })
    scheduler.start()

    // Remove while timer is active
    const removed = scheduler.remove('timed')
    expect(removed).toBe(true)
    expect(scheduler.getStatus()).toHaveLength(0)

    scheduler.stop()
  })

  test('queue overlap executes every queued run', async () => {
    const scheduler = new CronScheduler()
    let callCount = 0
    let resolveFirst: (() => void) | undefined

    scheduler.add({
      name: 'queue_job',
      cron: '0 0 * * *',
      instruction: 'queue test',
      overlapPolicy: { type: 'queue' },
    })

    scheduler.setTriggerHandler(async () => {
      callCount++
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
      }
    })

    const entry = expectDefined(scheduler.getEntry('queue_job'))
    const testableScheduler = scheduler as unknown as TestableCronScheduler

    const firstRun = testableScheduler.fire('queue_job', entry)
    await waitForTick()
    expect(callCount).toBe(1)

    await testableScheduler.fire('queue_job', entry)
    expect(callCount).toBe(1)

    resolveFirst?.()
    await firstRun
    await waitForTick()

    expect(callCount).toBe(2)
    scheduler.stop()
  })

  test('replace overlap coalesces to one rerun after current execution', async () => {
    const scheduler = new CronScheduler()
    let callCount = 0
    let resolveFirst: (() => void) | undefined

    scheduler.add({
      name: 'replace_job',
      cron: '0 0 * * *',
      instruction: 'replace test',
      overlapPolicy: { type: 'replace' },
    })

    scheduler.setTriggerHandler(async () => {
      callCount++
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
      }
    })

    const entry = expectDefined(scheduler.getEntry('replace_job'))
    const testableScheduler = scheduler as unknown as TestableCronScheduler

    const firstRun = testableScheduler.fire('replace_job', entry)
    await waitForTick()
    expect(callCount).toBe(1)

    await testableScheduler.fire('replace_job', entry)
    await testableScheduler.fire('replace_job', entry)
    expect(callCount).toBe(1)

    resolveFirst?.()
    await firstRun
    await waitForTick()

    expect(callCount).toBe(2)
    scheduler.stop()
  })

  test('launchFire catches trigger errors and logs them', async () => {
    const scheduler = new CronScheduler()
    const originalConsoleError = console.error
    const errors: unknown[][] = []

    scheduler.add({
      name: 'error_job',
      cron: '0 0 * * *',
      instruction: 'throw',
    })

    scheduler.setTriggerHandler(async () => {
      throw new Error('boom')
    })

    console.error = (...args: unknown[]) => {
      errors.push(args)
    }

    try {
      const entry = expectDefined(scheduler.getEntry('error_job'))
      const testableScheduler = scheduler as unknown as TestableCronScheduler
      testableScheduler.launchFire('error_job', entry)
      await waitForTick()

      expect(errors).toHaveLength(1)
      expect(String(errors[0][0])).toContain('schedule "error_job" failed')
      expect(errors[0][1]).toBeInstanceOf(Error)
      expect((errors[0][1] as Error).message).toBe('boom')
    } finally {
      console.error = originalConsoleError
      scheduler.stop()
    }
  })

  test('removing a schedule inside onTrigger prevents further triggers', async () => {
    const scheduler = new CronScheduler()
    let triggerCount = 0

    scheduler.setTriggerHandler(async (config) => {
      triggerCount++
      // Remove the schedule from within the trigger handler
      scheduler.remove(config.name)
    })

    scheduler.add({
      name: 'self_remove',
      cron: '* * * * * *',
      instruction: 'self removing job',
    })

    const entry = expectDefined(scheduler.getEntry('self_remove'))
    const testableScheduler = scheduler as unknown as TestableCronScheduler

    // Directly fire the entry
    await testableScheduler.fire('self_remove', entry)

    // Trigger handler ran exactly once
    expect(triggerCount).toBe(1)

    // Entry should be gone from the scheduler
    expect(scheduler.getEntry('self_remove')).toBeUndefined()
    expect(scheduler.getStatus()).toHaveLength(0)

    // Wait a bit and verify no further triggers happen
    await new Promise((r) => setTimeout(r, 100))
    expect(triggerCount).toBe(1)

    scheduler.stop()
  })
})
