import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'
import { MetricsDB } from '../metrics'
import { SessionDB } from '../session-db'
import { migrateSessionLayout } from '../session-layout-migration'
import { buildSessionId } from '@zero-os/shared'
import type { Message, Session as SessionData } from '@zero-os/shared'

const fixturesDir = join(import.meta.dir, '__fixtures__', 'session-layout-migration')

describe('migrateSessionLayout', () => {
  afterAll(() => {
    rmSync(join(import.meta.dir, '__fixtures__'), { recursive: true, force: true })
  })

  test('migrates DB rows, metrics, global logs, session logs, and _active symlinks', () => {
    const logsDir = join(fixturesDir, 'full-migration')
    ensureDir(logsDir)
    const sessionDb = new SessionDB(join(logsDir, 'sessions.db'))
    const metricsDb = new MetricsDB(join(logsDir, 'metrics.db'))
    const oldId = 'sess_20260313_a1b2c3d4'
    const createdAt = '2026-03-13T02:55:24.104Z'
    const expectedId = buildSessionId('fei', new Date(createdAt), 'a1b2')

    const session: SessionData = {
      id: oldId,
      source: 'feishu',
      status: 'active',
      currentModel: 'openai-codex/gpt-5.4',
      modelHistory: [{ model: 'openai-codex/gpt-5.4', from: createdAt, to: null }],
      tags: [],
      createdAt,
      updatedAt: createdAt,
    }

    const messages: Message[] = [
      {
        id: 'msg_1',
        sessionId: oldId,
        role: 'user',
        messageType: 'message',
        content: [{ type: 'text', text: 'hello' }],
        createdAt,
      },
    ]

    sessionDb.saveSession(session)
    sessionDb.saveMessages(oldId, messages)
    metricsDb.recordRequest({
      id: 'req_1',
      sessionId: oldId,
      model: 'openai-codex/gpt-5.4',
      provider: 'openai-codex',
      inputTokens: 1,
      outputTokens: 2,
      cost: 0.01,
      durationMs: 5,
      createdAt,
    })
    metricsDb.recordOperation({
      sessionId: oldId,
      tool: 'bash',
      event: 'tool_call',
      success: true,
      durationMs: 10,
      createdAt,
    })
    metricsDb.recordRepair({
      sessionId: oldId,
      status: 'success',
      diagnosis: 'test',
      action: 'noop',
      result: 'ok',
    })
    sessionDb.close()
    metricsDb.close()

    writeLegacyJsonl(
      join(logsDir, 'sessions', oldId, 'requests.jsonl'),
      [{ id: 'req_1', sessionId: oldId, ts: createdAt }],
    )
    writeLegacyJsonl(
      join(logsDir, 'sessions', oldId, 'snapshots.jsonl'),
      [{ id: 'snap_1', sessionId: oldId, trigger: 'session_start', ts: createdAt }],
    )
    writeLegacyJsonl(
      join(logsDir, 'sessions', oldId, 'closure.jsonl'),
      [{ sessionId: oldId, event: 'task_closure_decision', ts: createdAt }],
    )
    writeLegacyJsonl(join(logsDir, 'requests.jsonl'), [{ id: 'req_1', sessionId: oldId, ts: createdAt }])
    writeLegacyJsonl(
      join(logsDir, 'snapshots.jsonl'),
      [{ id: 'snap_1', sessionId: oldId, trigger: 'session_start', ts: createdAt }],
    )
    writeLegacyJsonl(join(logsDir, 'events.jsonl'), [
      { sessionId: oldId, event: 'task_closure_decision', ts: createdAt },
    ])

    const result = migrateSessionLayout(logsDir)
    expect(result.migratedSessions).toBe(1)
    expect(result.activeLinks).toBe(1)

    const migratedDb = new SessionDB(join(logsDir, 'sessions.db'))
    expect(migratedDb.getSession(oldId)).toBeNull()
    expect(migratedDb.getSession(expectedId)?.id).toBe(expectedId)
    expect(migratedDb.loadSessionMessages(expectedId)[0]?.sessionId).toBe(expectedId)
    migratedDb.close()

    const metrics = new Database(join(logsDir, 'metrics.db'))
    expect(
      (metrics.query('SELECT session_id FROM requests WHERE id = ?').get('req_1') as { session_id: string })
        .session_id,
    ).toBe(expectedId)
    expect(
      (metrics.query('SELECT session_id FROM operations LIMIT 1').get() as { session_id: string }).session_id,
    ).toBe(expectedId)
    expect(
      (metrics.query('SELECT session_id FROM repairs LIMIT 1').get() as { session_id: string | null }).session_id,
    ).toBe(expectedId)
    metrics.close()

    const migratedDir = join(logsDir, 'sessions', '2026-03-13', expectedId)
    expect(existsSync(migratedDir)).toBe(true)
    expect(readFileSync(join(migratedDir, 'requests.jsonl'), 'utf-8')).toContain(expectedId)
    expect(readFileSync(join(logsDir, 'requests.jsonl'), 'utf-8')).toContain(expectedId)
    expect(readFileSync(join(logsDir, 'events.jsonl'), 'utf-8')).toContain(expectedId)
    expect(readlinkSync(join(logsDir, 'sessions', '_active', expectedId))).toBe(
      `../2026-03-13/${expectedId}`,
    )
  })

  test('migrates orphan legacy directories with inferred time and leg source', () => {
    const logsDir = join(fixturesDir, 'orphan-migration')
    const oldId = 'sess_20260312_deadbeef'
    const ts = '2026-03-12T04:30:00.000Z'
    const expectedId = buildSessionId('leg', new Date(ts), 'dead')

    writeLegacyJsonl(
      join(logsDir, 'sessions', oldId, 'requests.jsonl'),
      [{ id: 'req_orphan', sessionId: oldId, ts }],
    )

    const result = migrateSessionLayout(logsDir)
    expect(result.migratedOrphanDirs).toBe(1)

    const migratedPath = join(logsDir, 'sessions', '2026-03-12', expectedId, 'requests.jsonl')
    expect(existsSync(migratedPath)).toBe(true)
    expect(readFileSync(migratedPath, 'utf-8')).toContain(expectedId)
  })

  test('falls back to alternate suffixes when migrated ids collide', () => {
    const logsDir = join(fixturesDir, 'collision-migration')
    ensureDir(logsDir)
    const sessionDb = new SessionDB(join(logsDir, 'sessions.db'))
    const createdAt = '2026-03-13T02:55:24.104Z'
    const firstOldId = 'sess_20260313_a1b2c3d4'
    const secondOldId = 'sess_20260313_a1b2ffff'
    const firstNewId = buildSessionId('fei', new Date(createdAt), 'a1b2')
    const secondNewId = buildSessionId('fei', new Date(createdAt), 'ffff')

    for (const id of [firstOldId, secondOldId]) {
      sessionDb.saveSession({
        id,
        source: 'feishu',
        status: 'completed',
        currentModel: 'openai-codex/gpt-5.4',
        modelHistory: [{ model: 'openai-codex/gpt-5.4', from: createdAt, to: null }],
        tags: [],
        createdAt,
        updatedAt: createdAt,
      })
    }
    sessionDb.close()

    migrateSessionLayout(logsDir)

    const migratedDb = new SessionDB(join(logsDir, 'sessions.db'))
    expect(migratedDb.getSession(firstNewId)?.id).toBe(firstNewId)
    expect(migratedDb.getSession(secondNewId)?.id).toBe(secondNewId)
    migratedDb.close()
  })
})

function writeLegacyJsonl(filePath: string, entries: unknown[]): void {
  ensureDir(dirname(filePath))
  writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf-8')
}

function ensureDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
  } catch {}
}
