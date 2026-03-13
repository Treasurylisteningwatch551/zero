import { describe, test, expect } from 'bun:test'
import { CronScheduler } from '../cron'

const waitForTick = () => new Promise((resolve) => setTimeout(resolve, 0))

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

    const entry = scheduler.getEntry('entry_test')
    expect(entry).toBeDefined()
    expect(entry!.config.name).toBe('entry_test')
    expect(entry!.running).toBe(false)
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
        source: 'feishu' as any,
        channelName: 'feishu',
        channelId: 'oc_abc123',
      },
      oneShot: true,
      createdBy: 'runtime',
    })

    const entry = scheduler.getEntry('bound_job')
    expect(entry).toBeDefined()
    expect(entry!.config.channel).toEqual({
      source: 'feishu',
      channelName: 'feishu',
      channelId: 'oc_abc123',
    })
    expect(entry!.config.oneShot).toBe(true)
    expect(entry!.config.createdBy).toBe('runtime')
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

    // Use a cron that would fire "now" via misfire policy
    const pastCron = '0 0 1 1 *' // Jan 1st midnight — always in the past
    scheduler.add({
      name: 'oneshot_test',
      cron: pastCron,
      instruction: 'fire once',
      oneShot: true,
      misfirePolicy: 'run_once',
    })

    // Manually get entry and fire it
    const entry = scheduler.getEntry('oneshot_test')
    expect(entry).toBeDefined()

    // Simulate fire by calling the internal method via start (which triggers misfire)
    scheduler.start()

    // Give it a tick to process
    await new Promise((r) => setTimeout(r, 50))

    expect(triggerCount).toBe(1)
    expect(removedName).toBe('oneshot_test')
    expect(scheduler.getEntry('oneshot_test')).toBeUndefined()
    expect(scheduler.getStatus()).toHaveLength(0)

    scheduler.stop()
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

    const entry = scheduler.getEntry('queue_job')
    expect(entry).toBeDefined()

    const firstRun = (scheduler as any).fire('queue_job', entry!)
    await waitForTick()
    expect(callCount).toBe(1)

    await (scheduler as any).fire('queue_job', entry!)
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

    const entry = scheduler.getEntry('replace_job')
    expect(entry).toBeDefined()

    const firstRun = (scheduler as any).fire('replace_job', entry!)
    await waitForTick()
    expect(callCount).toBe(1)

    await (scheduler as any).fire('replace_job', entry!)
    await (scheduler as any).fire('replace_job', entry!)
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
      const entry = scheduler.getEntry('error_job')
      expect(entry).toBeDefined()

      ;(scheduler as any).launchFire('error_job', entry!)
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
})
