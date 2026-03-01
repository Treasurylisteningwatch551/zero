import { describe, test, expect, afterEach } from 'bun:test'
import { BrowserTool } from '../browser'
import { Mutex } from '@zero-os/shared'

const BROWSER_TIMEOUT = 30_000

const ctx = {
  sessionId: 'test_browser_session',
  workDir: process.cwd(),
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}

describe('BrowserTool', () => {
  let mutex: Mutex
  let tool: BrowserTool

  afterEach(async () => {
    await tool.cleanup()
  })

  test('navigate to a URL and get content', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    const navResult = await tool.run(ctx, { action: 'navigate', url: 'https://example.com' })
    expect(navResult.success).toBe(true)
    expect(navResult.output).toContain('example.com')

    const contentResult = await tool.run(ctx, { action: 'content' })
    expect(contentResult.success).toBe(true)
    expect(contentResult.output).toContain('Example Domain')
  }, BROWSER_TIMEOUT)

  test('close releases mutex', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    await tool.run(ctx, { action: 'navigate', url: 'https://example.com' })
    expect(mutex.isLocked()).toBe(true)
    expect(mutex.getOwner()).toBe('test_browser_session')

    await tool.run(ctx, { action: 'close' })
    expect(mutex.isLocked()).toBe(false)
  }, BROWSER_TIMEOUT)

  test('returns error for missing url on navigate', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    const result = await tool.run(ctx, { action: 'navigate' })
    expect(result.success).toBe(false)
    expect(result.output).toContain('Missing required parameter: url')
  })

  test('returns error for missing selector on click', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    const result = await tool.run(ctx, { action: 'click' })
    expect(result.success).toBe(false)
    expect(result.output).toContain('Missing required parameter: selector')
  })

  test('returns error for missing selector on type', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    const result = await tool.run(ctx, { action: 'type', text: 'hello' })
    expect(result.success).toBe(false)
    expect(result.output).toContain('Missing required parameter: selector')
  })

  test('returns error for missing expression on evaluate', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    const result = await tool.run(ctx, { action: 'evaluate' })
    expect(result.success).toBe(false)
    expect(result.output).toContain('Missing required parameter: expression')
  })

  test('evaluate runs JavaScript on page', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    await tool.run(ctx, { action: 'navigate', url: 'https://example.com' })
    const result = await tool.run(ctx, { action: 'evaluate', expression: 'document.title' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Example Domain')
  }, BROWSER_TIMEOUT)

  test('screenshot returns base64 png', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    await tool.run(ctx, { action: 'navigate', url: 'https://example.com' })
    const result = await tool.run(ctx, { action: 'screenshot' })
    expect(result.success).toBe(true)
    expect(result.output).toStartWith('data:image/png;base64,')
  }, BROWSER_TIMEOUT)

  test('mutex blocks concurrent sessions', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    await tool.run(ctx, { action: 'navigate', url: 'https://example.com' })
    expect(mutex.getOwner()).toBe('test_browser_session')
    expect(mutex.isLocked()).toBe(true)
  }, BROWSER_TIMEOUT)

  test('cleanup is safe to call multiple times', async () => {
    mutex = new Mutex()
    tool = new BrowserTool(mutex)

    await tool.run(ctx, { action: 'navigate', url: 'https://example.com' })
    await tool.cleanup()
    await tool.cleanup()
    expect(mutex.isLocked()).toBe(false)
  }, BROWSER_TIMEOUT)
})
