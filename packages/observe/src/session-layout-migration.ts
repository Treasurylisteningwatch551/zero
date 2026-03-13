import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { Database } from 'bun:sqlite'
import {
  buildSessionId,
  getSessionLogRelativeDir,
  parseSessionId,
  sessionSourceToAbbreviation,
  type SessionSourceAbbreviation,
} from '@zero-os/shared'

interface SessionRow {
  id: string
  source: string
  created_at: string
  status: string
}

interface SessionMapping {
  oldId: string
  newId: string
  sourceCode: SessionSourceAbbreviation
  createdAt: string
  status?: string
  orphan: boolean
}

export interface SessionLayoutMigrationResult {
  migratedSessions: number
  migratedOrphanDirs: number
  movedSessionDirs: number
  rewrittenGlobalFiles: number
  activeLinks: number
}

export function migrateSessionLayout(logsDir: string): SessionLayoutMigrationResult {
  const sessionsRoot = join(logsDir, 'sessions')
  ensureDir(sessionsRoot)

  const sessionRows = loadSessionRows(join(logsDir, 'sessions.db'))
  const usedIds = new Set(
    sessionRows
      .map((row) => row.id)
      .filter((id) => {
        return parseSessionId(id)?.layout === 'dated'
      }),
  )

  const mappings: SessionMapping[] = sessionRows.map((row) => {
    const newId =
      parseSessionId(row.id)?.layout === 'dated'
        ? row.id
        : allocateMigratedSessionId({
            oldId: row.id,
            sourceCode: resolveSourceCode(row.source),
            createdAt: row.created_at,
            usedIds,
          })

    usedIds.add(newId)
    return {
      oldId: row.id,
      newId,
      sourceCode: resolveSourceCode(row.source),
      createdAt: row.created_at,
      status: row.status,
      orphan: false,
    }
  })

  const mappedIds = new Set(mappings.map((mapping) => mapping.oldId))
  const orphanMappings = listLegacySessionDirectories(sessionsRoot)
    .filter((oldId) => !mappedIds.has(oldId))
    .map((oldId) => {
      const inferredDate = inferOrphanDate(join(sessionsRoot, oldId))
      const newId = allocateMigratedSessionId({
        oldId,
        sourceCode: 'leg',
        createdAt: inferredDate.toISOString(),
        usedIds,
      })
      usedIds.add(newId)
      return {
        oldId,
        newId,
        sourceCode: 'leg' as const,
        createdAt: inferredDate.toISOString(),
        orphan: true,
      }
    })

  const allMappings = [...mappings, ...orphanMappings]
  const idMap = new Map(allMappings.map((mapping) => [mapping.oldId, mapping.newId]))

  migrateSessionDb(join(logsDir, 'sessions.db'), allMappings, idMap)
  migrateMetricsDb(join(logsDir, 'metrics.db'), idMap)
  const rewrittenGlobalFiles = rewriteGlobalJsonlFiles(logsDir, idMap)
  const movedSessionDirs = rewriteAndMoveSessionDirectories(logsDir, allMappings, idMap)
  const activeLinks = rebuildActiveSymlinks(logsDir, join(logsDir, 'sessions.db'))

  return {
    migratedSessions: mappings.filter((mapping) => mapping.oldId !== mapping.newId).length,
    migratedOrphanDirs: orphanMappings.length,
    movedSessionDirs,
    rewrittenGlobalFiles,
    activeLinks,
  }
}

function loadSessionRows(sessionDbPath: string): SessionRow[] {
  if (!existsSync(sessionDbPath)) return []
  const db = new Database(sessionDbPath)
  try {
    return db
      .query('SELECT id, source, created_at, status FROM sessions ORDER BY created_at ASC')
      .all() as SessionRow[]
  } finally {
    db.close()
  }
}

function migrateSessionDb(
  sessionDbPath: string,
  mappings: SessionMapping[],
  idMap: Map<string, string>,
): void {
  if (!existsSync(sessionDbPath)) return

  const db = new Database(sessionDbPath)
  try {
    db.run('BEGIN')

    for (const mapping of mappings) {
      if (mapping.orphan || mapping.oldId === mapping.newId) continue

      const messagesRow = db
        .query('SELECT messages_json FROM session_messages WHERE session_id = ?')
        .get(mapping.oldId) as { messages_json: string } | null

      if (messagesRow) {
        db.run('UPDATE session_messages SET session_id = ?, messages_json = ? WHERE session_id = ?', [
          mapping.newId,
          rewriteJsonPayload(messagesRow.messages_json, idMap),
          mapping.oldId,
        ])
      }

      db.run('UPDATE sessions SET id = ? WHERE id = ?', [mapping.newId, mapping.oldId])
    }

    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
}

function migrateMetricsDb(metricsDbPath: string, idMap: Map<string, string>): void {
  if (!existsSync(metricsDbPath)) return

  const db = new Database(metricsDbPath)
  try {
    db.run('BEGIN')
    for (const [oldId, newId] of idMap) {
      if (oldId === newId) continue
      db.run('UPDATE requests SET session_id = ? WHERE session_id = ?', [newId, oldId])
      db.run('UPDATE operations SET session_id = ? WHERE session_id = ?', [newId, oldId])
      db.run('UPDATE repairs SET session_id = ? WHERE session_id = ?', [newId, oldId])
    }
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
}

function rewriteGlobalJsonlFiles(logsDir: string, idMap: Map<string, string>): number {
  let rewritten = 0
  for (const file of ['requests.jsonl', 'operations.jsonl', 'snapshots.jsonl']) {
    const filePath = join(logsDir, file)
    if (!existsSync(filePath)) continue
    rewriteJsonlFile(filePath, idMap)
    rewritten++
  }
  return rewritten
}

function rewriteAndMoveSessionDirectories(
  logsDir: string,
  mappings: SessionMapping[],
  idMap: Map<string, string>,
): number {
  const sessionsRoot = join(logsDir, 'sessions')
  let moved = 0

  rmSync(join(sessionsRoot, '_active'), { recursive: true, force: true })

  for (const mapping of mappings) {
    const legacyDir = join(sessionsRoot, mapping.oldId)
    const nextDir = join(logsDir, getSessionLogRelativeDir(mapping.newId))

    if (existsSync(legacyDir)) {
      ensureDir(dirname(nextDir))
      if (legacyDir !== nextDir) {
        if (existsSync(nextDir)) {
          throw new Error(`Migration target already exists: ${nextDir}`)
        }
        renameSync(legacyDir, nextDir)
      }
      rewriteSessionDirectory(nextDir, idMap)
      moved++
      continue
    }

    if (existsSync(nextDir)) {
      rewriteSessionDirectory(nextDir, idMap)
    }
  }

  return moved
}

function rewriteSessionDirectory(dir: string, idMap: Map<string, string>): void {
  for (const file of ['requests.jsonl', 'snapshots.jsonl', 'closure.jsonl']) {
    const filePath = join(dir, file)
    if (existsSync(filePath)) {
      rewriteJsonlFile(filePath, idMap)
    }
  }
}

function rebuildActiveSymlinks(logsDir: string, sessionDbPath: string): number {
  const activeRoot = join(logsDir, 'sessions', '_active')
  rmSync(activeRoot, { recursive: true, force: true })
  ensureDir(activeRoot)

  if (!existsSync(sessionDbPath)) return 0

  const db = new Database(sessionDbPath)
  try {
    const rows = db
      .query(`SELECT id FROM sessions WHERE status = 'active' ORDER BY created_at ASC`)
      .all() as Array<{ id: string }>

    for (const row of rows) {
      const targetDir = join(logsDir, getSessionLogRelativeDir(row.id))
      ensureDir(targetDir)
      const linkPath = join(activeRoot, row.id)
      try {
        unlinkSync(linkPath)
      } catch {}
      symlinkSync(relative(activeRoot, targetDir), linkPath, 'dir')
    }

    return rows.length
  } finally {
    db.close()
  }
}

function listLegacySessionDirectories(sessionsRoot: string): string[] {
  if (!existsSync(sessionsRoot)) return []

  return readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .filter((name) => name !== '_active' && !/^\d{4}-\d{2}-\d{2}$/.test(name))
}

function inferOrphanDate(dir: string): Date {
  const timestamps: number[] = []

  for (const file of ['requests.jsonl', 'snapshots.jsonl', 'closure.jsonl']) {
    const filePath = join(dir, file)
    if (!existsSync(filePath)) continue

    const content = readFileSync(filePath, 'utf-8')
    for (const line of content.split('\n').filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as { ts?: string }
        if (parsed.ts) {
          const ts = new Date(parsed.ts).getTime()
          if (!Number.isNaN(ts)) {
            timestamps.push(ts)
          }
        }
      } catch {}
    }

    timestamps.push(statSync(filePath).mtimeMs)
  }

  timestamps.push(statSync(dir).mtimeMs)
  return new Date(Math.min(...timestamps))
}

function allocateMigratedSessionId(args: {
  oldId: string
  sourceCode: SessionSourceAbbreviation
  createdAt: string
  usedIds: Set<string>
}): string {
  const parsed = parseSessionId(args.oldId)
  const randomSeed = parsed?.random ?? stableHex(args.oldId, 8)
  const candidates = [
    randomSeed.slice(0, 4),
    randomSeed.slice(-4),
    stableHex(`${args.oldId}:${args.createdAt}`, 4),
  ].map((value) => value.toLowerCase())

  for (const candidate of candidates) {
    const nextId = buildSessionId(args.sourceCode, new Date(args.createdAt), candidate)
    if (!args.usedIds.has(nextId)) {
      return nextId
    }
  }

  throw new Error(`Unable to migrate session ID without collision: ${args.oldId}`)
}

function resolveSourceCode(source: string): SessionSourceAbbreviation {
  switch (source) {
    case 'web':
    case 'feishu':
    case 'telegram':
    case 'scheduler':
    case 'browser':
      return sessionSourceToAbbreviation(source)
    default:
      return 'leg'
  }
}

function rewriteJsonlFile(filePath: string, idMap: Map<string, string>): void {
  const content = readFileSync(filePath, 'utf-8')
  if (content.trim().length === 0) return

  const nextContent = content
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => rewriteJsonPayload(line, idMap))
    .join('\n')

  writeFileSync(filePath, `${nextContent}\n`, 'utf-8')
}

function rewriteJsonPayload(payload: string, idMap: Map<string, string>): string {
  try {
    const parsed = JSON.parse(payload) as unknown
    return JSON.stringify(rewriteSessionIds(parsed, idMap))
  } catch {
    return payload
  }
}

function rewriteSessionIds(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteSessionIds(entry, idMap))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const next: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    if ((key === 'sessionId' || key === 'session_id') && typeof raw === 'string') {
      next[key] = idMap.get(raw) ?? raw
      continue
    }

    next[key] = rewriteSessionIds(raw, idMap)
  }

  return next
}

function stableHex(input: string, length: number): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
