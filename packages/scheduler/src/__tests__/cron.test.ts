import { describe, expect, test } from 'bun:test'
import { CronScheduler } from '../cron'

describe('CronScheduler', () => {
  test('add schedule and get status', () => {
    const scheduler = new CronScheduler()

    scheduler.add({
      name: 'test_job',
      cron: '0 2 * * *',
      instruction: 'Run daily check',
    })

    const status = scheduler.getStatus()
    expect(status).toHaveLength(1)
    expect(status[0].name).toBe('test_job')
    expect(status[0].nextRun).toBeInstanceOf(Date)
    expect(status[0].running).toBe(false)
  })

  test('getNextRuns calculates future execution times', () => {
    const runs = CronScheduler.getNextRuns('0 9 * * 1', 3)
    expect(runs).toHaveLength(3)

    // All dates should be in the future
    for (const date of runs) {
      expect(date.getTime()).toBeGreaterThan(Date.now())
    }

    // All should be Mondays at 9:00
    for (const date of runs) {
      expect(date.getDay()).toBe(1) // Monday
      expect(date.getHours()).toBe(9)
    }
  })

  test('multiple schedules track independently', () => {
    const scheduler = new CronScheduler()

    scheduler.add({
      name: 'daily_check',
      cron: '0 2 * * *',
      instruction: 'Check updates',
    })

    scheduler.add({
      name: 'weekly_report',
      cron: '0 9 * * 1',
      instruction: 'Generate weekly report',
    })

    const status = scheduler.getStatus()
    expect(status).toHaveLength(2)

    const names = status.map((s) => s.name)
    expect(names).toContain('daily_check')
    expect(names).toContain('weekly_report')
  })

  test('start and stop without errors', () => {
    const scheduler = new CronScheduler()

    scheduler.add({
      name: 'test',
      cron: '*/5 * * * *',
      instruction: 'test',
    })

    scheduler.start()
    scheduler.stop()
  })
})
