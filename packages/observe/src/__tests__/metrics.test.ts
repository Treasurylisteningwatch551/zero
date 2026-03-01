import { describe, test, expect, afterAll } from 'bun:test'
import { MetricsDB } from '../metrics'
import { rmSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const testDir = join(import.meta.dir, '__fixtures__')
const dbPath = join(testDir, 'test-metrics.db')

describe('MetricsDB', () => {
  let db: MetricsDB

  afterAll(() => {
    db?.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  test('initialize and record requests', () => {
    mkdirSync(testDir, { recursive: true })
    db = new MetricsDB(dbPath)

    db.recordRequest({
      id: 'req_001',
      sessionId: 'sess_001',
      model: 'gpt-5.3-codex-medium',
      provider: 'openai-codex',
      inputTokens: 3200,
      outputTokens: 1800,
      cost: 0.028,
      durationMs: 1500,
      createdAt: new Date().toISOString(),
    })

    db.recordRequest({
      id: 'req_002',
      sessionId: 'sess_001',
      model: 'gpt-5.3-codex-medium',
      provider: 'openai-codex',
      inputTokens: 1500,
      outputTokens: 800,
      cost: 0.014,
      durationMs: 900,
      createdAt: new Date().toISOString(),
    })

    const summary = db.summary('1d')
    expect(summary.totalCost).toBeCloseTo(0.042, 3)
    expect(summary.requestCount).toBe(2)
    expect(summary.totalTokens).toBe(7300)
  })

  test('costByModel returns grouped data', () => {
    const costs = db.costByModel('1d')
    expect(costs.length).toBe(1)
    expect(costs[0].model).toBe('gpt-5.3-codex-medium')
    expect(costs[0].requestCount).toBe(2)
  })

  test('record and query tool operations', () => {
    db.recordOperation({
      sessionId: 'sess_001',
      tool: 'bash',
      event: 'tool_call',
      success: true,
      durationMs: 45,
      createdAt: new Date().toISOString(),
    })

    db.recordOperation({
      sessionId: 'sess_001',
      tool: 'bash',
      event: 'tool_call',
      success: false,
      durationMs: 100,
      createdAt: new Date().toISOString(),
    })

    const stats = db.toolStats('1d')
    expect(stats.length).toBe(1)
    expect(stats[0].tool).toBe('bash')
    expect(stats[0].count).toBe(2)
    expect(stats[0].successRate).toBe(0.5)
  })

  test('costByDay returns daily aggregation', () => {
    const daily = db.costByDay('30d')
    expect(daily.length).toBeGreaterThanOrEqual(1)
    expect(daily[0].totalCost).toBeGreaterThan(0)
  })
})
