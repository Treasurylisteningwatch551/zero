import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const tempDirs: string[] = []

describe('CodexTool', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('has correct tool definition', () => {
    const tool = new CodexTool()
    const def = tool.toDefinition()
    expect(def.name).toBe('codex')
    expect(def.description).toContain('code engineering')
    expect(def.parameters.required).toEqual(['instruction'])
    expect(def.parameters.properties).toHaveProperty('instruction')
    expect(def.parameters.properties).toHaveProperty('workingDirectory')
    expect(def.parameters.properties).toHaveProperty('model')
    expect(def.parameters.properties).not.toHaveProperty('timeout')
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
    const result = await tool.run(ctx, { instruction: 'test' })
    expect(result.success).toBe(false)
    expect(result.output).toContain('Codex execution failed')
  })

  test('waits for codex process exit without scheduling a timeout', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'codex-tool-test-'))
    tempDirs.push(fixtureDir)

    const scriptPath = join(fixtureDir, 'fake-codex')
    writeFileSync(
      scriptPath,
      `#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"thread.started","thread_id":"thread_test"}'
printf '%s\n' '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Applied fake codex change"}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"file_1","type":"file_change","changes":[{"path":"src/example.ts","kind":"updated"}]}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"cmd_1","type":"command_execution","command":"bun test","aggregated_output":"ok","exit_code":0,"status":"completed"}}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":2}}'
`,
      'utf-8',
    )
    chmodSync(scriptPath, 0o755)

    const setTimeoutSpy = spyOn(globalThis, 'setTimeout')

    try {
      const tool = new CodexTool({ codexPath: scriptPath })
      const result = await tool.run(ctx, {
        instruction: 'Apply a fake codex change',
        timeout: 1,
      })

      expect(result.success).toBe(true)
      expect(result.output).toContain('Applied fake codex change')
      expect(result.output).toContain('[updated] src/example.ts')
      expect(result.output).toContain('`bun test`')
      expect(result.outputSummary).toBe('1 file(s) changed, 1 command(s) run')
      expect(result.artifacts).toEqual(['src/example.ts'])
      expect(setTimeoutSpy).not.toHaveBeenCalled()
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })

  test('injects session and channel env vars into codex subprocesses', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'codex-tool-env-test-'))
    tempDirs.push(fixtureDir)
    const projectRoot = mkdtempSync(join(tmpdir(), 'codex-project-'))
    tempDirs.push(projectRoot)

    const scriptPath = join(fixtureDir, 'fake-codex-env')
    writeFileSync(
      scriptPath,
      `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"type":"thread.started","thread_id":"thread_test"}'
printf '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"%s|%s|%s|%s|%s"}}\\n' "$ZERO_WORKSPACE" "$ZERO_PROJECT_ROOT" "$ZERO_SESSION_ID" "$ZERO_CHANNEL_NAME" "$ZERO_CHANNEL_ID"
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":2}}'
`,
      'utf-8',
    )
    chmodSync(scriptPath, 0o755)

    const tool = new CodexTool({ codexPath: scriptPath })
    const result = await tool.run(
      {
        ...ctx,
        projectRoot,
        channelBinding: {
          source: 'feishu',
          channelName: 'feishu:ops',
          channelId: 'chat-99',
        },
      },
      {
        instruction: 'Check env injection',
      },
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain(`${ctx.workDir}|${projectRoot}|test_session|feishu:ops|chat-99`)
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
