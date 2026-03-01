import { chromium, type Browser, type Page } from 'playwright-core'
import { Mutex } from '@zero-os/shared'
import { BaseTool } from './base'
import type { ToolContext, ToolResult } from '@zero-os/shared'

type BrowserAction = 'navigate' | 'click' | 'type' | 'screenshot' | 'content' | 'evaluate' | 'close'

interface BrowserInput {
  action: BrowserAction
  url?: string
  selector?: string
  text?: string
  expression?: string
  timeout?: number
}

const MAX_CONTENT_LENGTH = 50_000

export class BrowserTool extends BaseTool {
  name = 'browser'
  description =
    'Control a headless browser. Actions: navigate (go to URL), click (click element), type (fill input), screenshot (capture page), content (extract page text), evaluate (run JS), close (release browser).'
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'click', 'type', 'screenshot', 'content', 'evaluate', 'close'],
        description: 'Browser action to perform',
      },
      url: { type: 'string', description: 'Target URL (required for navigate)' },
      selector: { type: 'string', description: 'CSS selector (required for click, type)' },
      text: { type: 'string', description: 'Text to type (required for type)' },
      expression: { type: 'string', description: 'JavaScript expression (required for evaluate)' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
    },
    required: ['action'],
  }

  private mutex: Mutex
  private browser: Browser | null = null
  private page: Page | null = null
  private currentSessionId: string | null = null

  constructor(mutex: Mutex) {
    super()
    this.mutex = mutex
  }

  protected async beforeExecute(ctx: ToolContext, _input: unknown): Promise<void> {
    const { action } = _input as BrowserInput
    // close doesn't need to acquire — it releases
    if (action === 'close') return

    // If this session already owns the mutex, skip acquiring
    if (this.currentSessionId === ctx.sessionId) return

    await this.mutex.acquire(ctx.sessionId)
    this.currentSessionId = ctx.sessionId
  }

  protected async execute(ctx: ToolContext, input: unknown): Promise<ToolResult> {
    const { action, url, selector, text, expression, timeout = 30_000 } = input as BrowserInput

    switch (action) {
      case 'navigate':
        return this.doNavigate(url, timeout)
      case 'click':
        return this.doClick(selector, timeout)
      case 'type':
        return this.doType(selector, text, timeout)
      case 'screenshot':
        return this.doScreenshot()
      case 'content':
        return this.doContent()
      case 'evaluate':
        return this.doEvaluate(expression)
      case 'close':
        return this.doClose(ctx.sessionId)
      default:
        return { success: false, output: `Unknown action: ${action}`, outputSummary: 'Unknown action' }
    }
  }

  private async ensureBrowser(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true })
    }
    if (!this.page) {
      this.page = await this.browser.newPage()
    }
    return this.page
  }

  private async doNavigate(url: string | undefined, timeout: number): Promise<ToolResult> {
    if (!url) {
      return { success: false, output: 'Missing required parameter: url', outputSummary: 'Missing url' }
    }

    const page = await this.ensureBrowser()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
    const title = await page.title()

    return {
      success: true,
      output: `Navigated to ${url}\nTitle: ${title}`,
      outputSummary: `Navigated to ${url}`,
    }
  }

  private async doClick(selector: string | undefined, timeout: number): Promise<ToolResult> {
    if (!selector) {
      return { success: false, output: 'Missing required parameter: selector', outputSummary: 'Missing selector' }
    }

    const page = await this.ensureBrowser()
    await page.click(selector, { timeout })

    return {
      success: true,
      output: `Clicked: ${selector}`,
      outputSummary: `Clicked ${selector}`,
    }
  }

  private async doType(
    selector: string | undefined,
    text: string | undefined,
    timeout: number
  ): Promise<ToolResult> {
    if (!selector) {
      return { success: false, output: 'Missing required parameter: selector', outputSummary: 'Missing selector' }
    }
    if (!text) {
      return { success: false, output: 'Missing required parameter: text', outputSummary: 'Missing text' }
    }

    const page = await this.ensureBrowser()
    await page.fill(selector, text, { timeout })

    return {
      success: true,
      output: `Typed "${text.slice(0, 50)}" into ${selector}`,
      outputSummary: `Typed into ${selector}`,
    }
  }

  private async doScreenshot(): Promise<ToolResult> {
    const page = await this.ensureBrowser()
    const buffer = await page.screenshot({ type: 'png', fullPage: false })
    const base64 = buffer.toString('base64')

    return {
      success: true,
      output: `data:image/png;base64,${base64}`,
      outputSummary: `Screenshot captured (${Math.round(buffer.length / 1024)}KB)`,
    }
  }

  private async doContent(): Promise<ToolResult> {
    const page = await this.ensureBrowser()
    let content = await page.innerText('body')

    const truncated = content.length > MAX_CONTENT_LENGTH
    if (truncated) {
      content = content.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated at 50,000 characters]'
    }

    return {
      success: true,
      output: content,
      outputSummary: `Extracted page content (${content.length} chars${truncated ? ', truncated' : ''})`,
    }
  }

  private async doEvaluate(expression: string | undefined): Promise<ToolResult> {
    if (!expression) {
      return {
        success: false,
        output: 'Missing required parameter: expression',
        outputSummary: 'Missing expression',
      }
    }

    const page = await this.ensureBrowser()
    const result = await page.evaluate(expression)
    const output = JSON.stringify(result, null, 2)

    return {
      success: true,
      output,
      outputSummary: `Evaluated JS expression`,
    }
  }

  private async doClose(sessionId: string): Promise<ToolResult> {
    await this.cleanup()

    return {
      success: true,
      output: 'Browser closed',
      outputSummary: 'Browser closed',
    }
  }

  /**
   * Clean up browser resources and release mutex.
   * Called by close action or session teardown.
   */
  async cleanup(): Promise<void> {
    if (this.page) {
      await this.page.close().catch(() => {})
      this.page = null
    }
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
    if (this.currentSessionId && this.mutex.isLocked()) {
      this.mutex.release(this.currentSessionId)
    }
    this.currentSessionId = null
  }
}
