import { describe, test, expect, afterAll } from 'bun:test'
import { HeartbeatWriter, HeartbeatChecker } from '../heartbeat'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

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
})
