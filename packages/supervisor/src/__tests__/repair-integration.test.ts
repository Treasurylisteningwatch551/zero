import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HeartbeatChecker, HeartbeatWriter } from '../heartbeat'
import { RepairEngine } from '../repair'

const tmpDir = mkdtempSync(join(tmpdir(), 'zero-repair-int-'))
const heartbeatPath = join(tmpDir, 'heartbeat.json')

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined()
  if (value == null) {
    throw new Error('Expected value to be defined')
  }
  return value
}

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('Heartbeat + Repair Integration', () => {
  test('heartbeat writes file → checker detects alive', () => {
    const writer = new HeartbeatWriter(heartbeatPath)
    writer.write()

    const checker = new HeartbeatChecker(heartbeatPath)
    const result = checker.check()
    expect(result.alive).toBe(true)
    expect(result.lastBeat).toBeDefined()
    expect(result.elapsedMs).toBeDefined()
    expect(expectDefined(result.elapsedMs)).toBeLessThan(5000)
    expect(result.pid).toBe(process.pid)
  })

  test('no heartbeat file → checker detects dead', () => {
    const checker = new HeartbeatChecker(join(tmpDir, 'nonexistent.json'))
    const result = checker.check()
    expect(result.alive).toBe(false)
    expect(result.lastBeat).toBeUndefined()
  })

  test('repair verify failure → shouldFuse triggers after maxAttempts', async () => {
    const engine = new RepairEngine(3)

    for (let i = 0; i < 3; i++) {
      await engine.runRepairCycle(
        async () => 'Issue found',
        async () => 'Fix applied',
        async () => false, // verify always fails
      )
    }

    expect(engine.shouldFuse()).toBe(true)
    expect(engine.getAttemptCount()).toBe(3)
    expect(engine.getStatus()).toBe('failed')
  })

  test('repair reset clears fuse state', async () => {
    const engine = new RepairEngine(2)

    // Trigger fuse
    for (let i = 0; i < 2; i++) {
      await engine.runRepairCycle(
        async () => 'Issue found',
        async () => 'Fix applied',
        async () => false,
      )
    }
    expect(engine.shouldFuse()).toBe(true)

    // Reset
    engine.reset()
    expect(engine.shouldFuse()).toBe(false)
    expect(engine.getStatus()).toBe('idle')
    expect(engine.getAttemptCount()).toBe(0)
  })
})
