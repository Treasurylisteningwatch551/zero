import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { SessionDB } from '../session-db'
import type { ScheduleConfig } from '@zero-os/shared'

describe('SessionDB — schedule persistence', () => {
  let db: SessionDB

  beforeEach(() => {
    db = SessionDB.createInMemory()
  })

  afterEach(() => {
    db.close()
  })

  test('saveSchedule + loadRuntimeSchedules round-trip', () => {
    const config: ScheduleConfig = {
      name: 'daily-check',
      cron: '0 9 * * *',
      instruction: 'Check system health',
      createdBy: 'runtime',
    }

    db.saveSchedule(config)
    const loaded = db.loadRuntimeSchedules()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].name).toBe('daily-check')
    expect(loaded[0].cron).toBe('0 9 * * *')
    expect(loaded[0].instruction).toBe('Check system health')
    expect(loaded[0].createdBy).toBe('runtime')
  })

  test('saveSchedule with channel binding', () => {
    const config: ScheduleConfig = {
      name: 'remind-user',
      cron: '*/10 * * * *',
      instruction: 'Send reminder',
      oneShot: true,
      createdBy: 'runtime',
      channel: {
        source: 'feishu' as any,
        channelName: 'feishu',
        channelId: 'oc_abc123',
      },
    }

    db.saveSchedule(config)
    const loaded = db.loadRuntimeSchedules()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].channel).toEqual({
      source: 'feishu',
      channelName: 'feishu',
      channelId: 'oc_abc123',
    })
    expect(loaded[0].oneShot).toBe(true)
  })

  test('saveSchedule upserts on duplicate name', () => {
    db.saveSchedule({ name: 'job', cron: '0 1 * * *', instruction: 'v1', createdBy: 'runtime' })
    db.saveSchedule({ name: 'job', cron: '0 2 * * *', instruction: 'v2', createdBy: 'runtime' })

    const loaded = db.loadRuntimeSchedules()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].cron).toBe('0 2 * * *')
    expect(loaded[0].instruction).toBe('v2')
  })

  test('deleteSchedule removes and returns true', () => {
    db.saveSchedule({ name: 'to-delete', cron: '0 0 * * *', instruction: 'bye', createdBy: 'runtime' })
    expect(db.loadRuntimeSchedules()).toHaveLength(1)

    const deleted = db.deleteSchedule('to-delete')
    expect(deleted).toBe(true)
    expect(db.loadRuntimeSchedules()).toHaveLength(0)
  })

  test('deleteSchedule returns false for non-existent', () => {
    expect(db.deleteSchedule('nope')).toBe(false)
  })

  test('loadRuntimeSchedules only returns runtime, not config', () => {
    db.saveSchedule({ name: 'from-config', cron: '0 0 * * *', instruction: 'config', createdBy: 'config' })
    db.saveSchedule({ name: 'from-runtime', cron: '0 1 * * *', instruction: 'runtime', createdBy: 'runtime' })

    const loaded = db.loadRuntimeSchedules()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].name).toBe('from-runtime')
  })

  test('saveSchedule with overlapPolicy and misfirePolicy', () => {
    db.saveSchedule({
      name: 'full-config',
      cron: '*/5 * * * *',
      instruction: 'do stuff',
      model: 'gpt-4',
      overlapPolicy: { type: 'queue' },
      misfirePolicy: 'run_once',
      createdBy: 'runtime',
    })

    const loaded = db.loadRuntimeSchedules()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].model).toBe('gpt-4')
    expect(loaded[0].overlapPolicy).toEqual({ type: 'queue' })
    expect(loaded[0].misfirePolicy).toBe('run_once')
  })
})
