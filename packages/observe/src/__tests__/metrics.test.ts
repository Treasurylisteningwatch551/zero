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

  test('cacheHitRate returns daily ratio', () => {
    // req_001 and req_002 have no cache_read_tokens set, so hitRate should be 0 or null
    // Add a request with cache tokens
    db.recordRequest({
      id: 'req_cache_001',
      sessionId: 'sess_002',
      model: 'claude-opus',
      provider: 'anthropic',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 400,
      cost: 0.01,
      durationMs: 800,
      createdAt: new Date().toISOString(),
    })

    const rates = db.cacheHitRate('1d')
    expect(rates.length).toBeGreaterThanOrEqual(1)
    // Today's data includes requests with and without cache
    // Total input = 3200 + 1500 + 1000 = 5700, cache_read = 0 + 0 + 400 = 400
    const todayRate = rates.find((r) => r.period === new Date().toISOString().slice(0, 10))
    expect(todayRate).toBeDefined()
    expect(todayRate!.hitRate).toBeCloseTo(400 / 5700, 3)
  })

  test('taskSuccessRate returns daily success rate', () => {
    const rates = db.taskSuccessRate('1d')
    expect(rates.length).toBeGreaterThanOrEqual(1)
    const today = rates.find((r) => r.period === new Date().toISOString().slice(0, 10))
    expect(today).toBeDefined()
    expect(today!.successRate).toBe(0.5) // 1 success + 1 failure from earlier
    expect(today!.total).toBe(2)
  })

  test('avgDurationByDay returns average operation duration', () => {
    const durations = db.avgDurationByDay('1d')
    expect(durations.length).toBeGreaterThanOrEqual(1)
    const today = durations.find((d) => d.period === new Date().toISOString().slice(0, 10))
    expect(today).toBeDefined()
    // avg of 45 and 100 = 72.5
    expect(today!.avgMs).toBeCloseTo(72.5, 0)
  })

  test('costByDayModel returns per-model daily cost', () => {
    const data = db.costByDayModel('1d')
    expect(data.length).toBeGreaterThanOrEqual(1)
    // Should have entries for both models
    const models = new Set(data.map((d) => d.model))
    expect(models.has('gpt-5.3-codex-medium')).toBe(true)
    expect(models.has('claude-opus')).toBe(true)
  })

  test('recordRepair and repairStats', () => {
    db.recordRepair({
      sessionId: 'sess_001',
      status: 'success',
      diagnosis: 'API timeout detected',
      action: 'Retried with fallback model',
      result: 'Verification passed',
    })

    db.recordRepair({
      sessionId: 'sess_001',
      status: 'failed',
      diagnosis: 'Connection refused',
      action: 'Attempted reconnect',
      result: 'Verification failed',
    })

    const stats = db.repairStats('1d')
    expect(stats.total).toBe(2)
    expect(stats.successCount).toBe(1)
    expect(stats.successRate).toBeCloseTo(0.5, 2)
  })

  test('repairByDay returns daily repair trend', () => {
    const trend = db.repairByDay('1d')
    expect(trend.length).toBeGreaterThanOrEqual(1)
    const today = trend.find((t) => t.period === new Date().toISOString().slice(0, 10))
    expect(today).toBeDefined()
    expect(today!.total).toBe(2)
    expect(today!.success).toBe(1)
  })

  test('costDetailRecords returns per-model daily breakdown', () => {
    const records = db.costDetailRecords('1d')
    expect(records.length).toBeGreaterThanOrEqual(1)
    // Check that we have fields for input, output, cacheRead
    const first = records[0]
    expect(first.date).toBeDefined()
    expect(first.model).toBeDefined()
    expect(typeof first.input).toBe('number')
    expect(typeof first.output).toBe('number')
    expect(typeof first.cacheRead).toBe('number')
    expect(typeof first.cost).toBe('number')
  })

  test('toolErrorByDay returns per-tool daily error counts', () => {
    // Add a different tool operation
    db.recordOperation({
      sessionId: 'sess_001',
      tool: 'read',
      event: 'tool_call',
      success: false,
      durationMs: 30,
      createdAt: new Date().toISOString(),
    })

    const errors = db.toolErrorByDay('1d')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    // Should have entries for both bash and read tools
    const tools = new Set(errors.map((e) => e.tool))
    expect(tools.has('bash')).toBe(true)
    expect(tools.has('read')).toBe(true)
    // bash had 1 error out of 2, read had 1 error out of 1
    const bashEntry = errors.find((e) => e.tool === 'bash')
    expect(bashEntry!.errors).toBe(1)
    const readEntry = errors.find((e) => e.tool === 'read')
    expect(readEntry!.errors).toBe(1)
  })
})
