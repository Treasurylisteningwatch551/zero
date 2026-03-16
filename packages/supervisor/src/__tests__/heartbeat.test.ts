import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { HeartbeatChecker, HeartbeatWriter, waitForHeartbeatReady } from '../heartbeat'

const testDir = join(import.meta.dir, '__fixtures__')
const heartbeatFile = join(testDir, 'heartbeat.json')

describe('Heartbeat', () => {
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('write and check heartbeat', () => {
    mkdirSync(testDir, { recursive: true })
    const writer = new HeartbeatWriter(heartbeatFile)
    const checker = new HeartbeatChecker(heartbeatFile)

    writer.write()

    const result = checker.check()
    expect(result.alive).toBe(true)
    expect(result.ready).toBe(false)
    expect(result.stage).toBe('booting')
    expect(result.pid).toBe(process.pid)
    expect(result.elapsedMs).toBeLessThan(5000)
  })

  test('checker returns not alive for missing file', () => {
    const checker = new HeartbeatChecker(join(testDir, 'nonexistent.json'))
    const result = checker.check()
    expect(result.alive).toBe(false)
  })

  test('start/stop writer', async () => {
    mkdirSync(testDir, { recursive: true })
    const file = join(testDir, 'heartbeat-timer.json')
    const writer = new HeartbeatWriter(file)
    const checker = new HeartbeatChecker(file)

    writer.start()

    // Wait a moment for the first heartbeat
    await new Promise((r) => setTimeout(r, 100))

    const result = checker.check()
    expect(result.alive).toBe(true)

    writer.stop()
  })

  test('configured offline channels degrade heartbeat health', () => {
    mkdirSync(testDir, { recursive: true })
    const file = join(testDir, 'heartbeat-channel-health.json')
    const writer = new HeartbeatWriter(file)
    const checker = new HeartbeatChecker(file)

    writer.setHealthMetrics({
      errorCount: 0,
      channels: [
        { name: 'web', type: 'web', connected: true, configured: true },
        { name: 'feishu', type: 'feishu', connected: false, configured: true },
        { name: 'telegram', type: 'telegram', connected: false, configured: false },
      ],
    })
    writer.write()

    const result = checker.check()
    expect(result.alive).toBe(true)
    expect(result.health?.status).toBe('degraded')
    expect(result.health?.channels).toEqual({
      total: 3,
      configured: 2,
      connected: 1,
      disconnected: 1,
      offline: ['feishu'],
    })
  })

  test('ready state is persisted in heartbeat file', () => {
    mkdirSync(testDir, { recursive: true })
    const file = join(testDir, 'heartbeat-ready.json')
    const writer = new HeartbeatWriter(file)
    const checker = new HeartbeatChecker(file)

    writer.setReady(true)
    writer.write()

    const result = checker.check()
    expect(result.alive).toBe(true)
    expect(result.ready).toBe(true)
    expect(result.stage).toBe('ready')
  })

  test('waitForHeartbeatReady waits until heartbeat becomes ready', async () => {
    mkdirSync(testDir, { recursive: true })
    const file = join(testDir, 'heartbeat-wait-ready.json')
    const writer = new HeartbeatWriter(file)
    const checker = new HeartbeatChecker(file)

    writer.write()

    setTimeout(() => {
      writer.setReady(true)
      writer.write()
    }, 50)

    await expect(
      waitForHeartbeatReady(checker, { timeoutMs: 500, pollIntervalMs: 10 }),
    ).resolves.toBe(true)
  })
})
