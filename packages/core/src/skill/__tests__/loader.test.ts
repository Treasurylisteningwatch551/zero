import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadSkills } from '../loader'
import { buildSkillsBlock } from '../../agent/prompt'

const TEST_DIR = join(import.meta.dir, '__fixtures__', 'skills')

beforeAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(join(TEST_DIR, 'browser'), { recursive: true })
  mkdirSync(join(TEST_DIR, 'empty-dir'), { recursive: true })

  writeFileSync(join(TEST_DIR, 'browser', 'SKILL.md'), `---
name: browser
description: |
  通过 agent-browser CLI 控制浏览器。
  触发词：浏览器、打开网页、截图。
allowed-tools:
  - bash
---

# Browser Skill

通过 agent-browser CLI 控制 CDP 浏览器。

## Core Workflow

1. Navigate — \`agent-browser open <url>\`
2. Snapshot — \`agent-browser snapshot -i\`
`)
})

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('loadSkills', () => {
  it('loads skills from directory', () => {
    const skills = loadSkills(TEST_DIR)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('browser')
    expect(skills[0].allowedTools).toEqual(['bash'])
    expect(skills[0].content).toContain('# Browser Skill')
    expect(skills[0].description).toContain('agent-browser CLI')
  })

  it('returns empty array for non-existent directory', () => {
    const skills = loadSkills('/tmp/non-existent-skills-dir')
    expect(skills).toEqual([])
  })

  it('skips subdirectories without SKILL.md', () => {
    const skills = loadSkills(TEST_DIR)
    // empty-dir has no SKILL.md, should be skipped
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('browser')
  })

  it('uses directory name as fallback when frontmatter has no name', () => {
    mkdirSync(join(TEST_DIR, 'noname'), { recursive: true })
    writeFileSync(join(TEST_DIR, 'noname', 'SKILL.md'), `---
description: A skill without a name field.
allowed-tools:
  - read
---

# No Name Skill

This skill has no name in frontmatter.
`)
    const skills = loadSkills(TEST_DIR)
    const noname = skills.find(s => s.name === 'noname')
    expect(noname).toBeDefined()
    expect(noname!.allowedTools).toEqual(['read'])

    rmSync(join(TEST_DIR, 'noname'), { recursive: true })
  })

  it('handles missing allowed-tools gracefully', () => {
    mkdirSync(join(TEST_DIR, 'minimal'), { recursive: true })
    writeFileSync(join(TEST_DIR, 'minimal', 'SKILL.md'), `---
name: minimal
---

Minimal skill.
`)
    const skills = loadSkills(TEST_DIR)
    const minimal = skills.find(s => s.name === 'minimal')
    expect(minimal).toBeDefined()
    expect(minimal!.allowedTools).toEqual([])
    expect(minimal!.description).toBe('')

    rmSync(join(TEST_DIR, 'minimal'), { recursive: true })
  })
})

describe('buildSkillsBlock', () => {
  it('renders skills as XML', () => {
    const skills = loadSkills(TEST_DIR)
    const block = buildSkillsBlock(skills)
    expect(block).toContain('<skills>')
    expect(block).toContain('</skills>')
    expect(block).toContain('<skill name="browser" allowed-tools="bash">')
    expect(block).toContain('# Browser Skill')
  })

  it('renders multiple skills', () => {
    const block = buildSkillsBlock([
      { name: 'a', description: 'Skill A', allowedTools: ['bash'], content: 'Content A' },
      { name: 'b', description: 'Skill B', allowedTools: ['read', 'write'], content: 'Content B' },
    ])
    expect(block).toContain('name="a"')
    expect(block).toContain('name="b"')
    expect(block).toContain('allowed-tools="read, write"')
    expect(block).toContain('Content A')
    expect(block).toContain('Content B')
  })
})
