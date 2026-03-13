import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { MemoManager } from '../memo'

const testDir = join(import.meta.dir, '__fixtures__')
const memoPath = join(testDir, 'memo.md')

describe('MemoManager', () => {
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('read returns default content when file missing', () => {
    const manager = new MemoManager(join(testDir, 'nonexistent-memo.md'))
    const content = manager.read()
    expect(content).toContain('# Memo')
    expect(content).toContain('## Goals')
  })

  test('write and read round-trip', async () => {
    mkdirSync(testDir, { recursive: true })
    const manager = new MemoManager(memoPath)
    const content = '# Memo\n\n## Goals\n- Build v1.0\n'

    await manager.write(content)
    const result = manager.read()
    expect(result).toBe(content)
  })

  test('updateAgentSection adds new section', async () => {
    mkdirSync(testDir, { recursive: true })
    const manager = new MemoManager(memoPath)
    await manager.write('# Memo\n\n## Goals\n- Build v1.0\n')

    await manager.updateAgentSection('Coder Agent', 'Building model layer', 'Run tests next')

    const result = manager.read()
    expect(result).toContain('### Coder Agent')
    expect(result).toContain('Building model layer')
    expect(result).toContain('Run tests next')
  })

  test('updateAgentSection updates existing section', async () => {
    const manager = new MemoManager(memoPath)

    await manager.updateAgentSection('Coder Agent', 'Tests complete', 'Deploy to prod')

    const result = manager.read()
    expect(result).toContain('Tests complete')
    expect(result).toContain('Deploy to prod')
    expect(result).not.toContain('Building model layer')
  })

  test('addUserAction adds to needs section', async () => {
    mkdirSync(testDir, { recursive: true })
    const manager = new MemoManager(memoPath)
    await manager.write('# Memo\n\n## Goals\n\n## Needs User Action\n')

    await manager.addUserAction('Provide Telegram Bot Token')

    const result = manager.read()
    expect(result).toContain('Provide Telegram Bot Token')
  })

  test('addGoal adds to goals section', async () => {
    const manager = new MemoManager(memoPath)

    await manager.addGoal('Complete v2.0 release')

    const result = manager.read()
    expect(result).toContain('Complete v2.0 release')
  })
})
