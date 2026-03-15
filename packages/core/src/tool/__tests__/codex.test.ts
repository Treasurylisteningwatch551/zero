import { describe, expect, test } from 'bun:test'
import { CodexTool } from '../codex'

const ctx = {
  sessionId: 'test_session',
  workDir: process.cwd(),
  projectRoot: process.cwd(),
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}

describe('CodexTool', () => {
  test('has correct tool definition', () => {
    const tool = new CodexTool()
    const def = tool.toDefinition()
    expect(def.name).toBe('codex')
    expect(def.description).toContain('code engineering')
    expect(def.parameters.required).toEqual(['instruction'])
    expect(def.parameters.properties).toHaveProperty('instruction')
    expect(def.parameters.properties).toHaveProperty('workingDirectory')
    expect(def.parameters.properties).toHaveProperty('model')
    expect(def.parameters.properties).toHaveProperty('timeout')
  })

  test('validates required instruction field', async () => {
    const tool = new CodexTool()
    const result = await tool.run(ctx, {})
    expect(result.success).toBe(false)
    expect(result.output).toContain('missing required fields')
    expect(result.output).toContain('instruction')
  })

  test('handles missing codex binary gracefully', async () => {
    const tool = new CodexTool({ codexPath: '/nonexistent/codex-binary' })
    const result = await tool.run(ctx, { instruction: 'test', timeout: 5000 })
    expect(result.success).toBe(false)
    expect(result.output).toContain('Codex execution failed')
  })

  test('accepts custom codex path', () => {
    const tool = new CodexTool({ codexPath: '/usr/local/bin/codex' })
    expect(tool.toDefinition().name).toBe('codex')
  })

  test('accepts profile option', () => {
    const tool = new CodexTool({ profile: 'rightcode' })
    expect(tool.toDefinition().name).toBe('codex')
  })
})
