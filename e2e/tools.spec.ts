import { test, expect } from '@playwright/test'

test.describe('Tools Page', () => {
  test('shows tools heading', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Tools")').click()
    await expect(page.locator('main h1')).toContainText('Tools')
  })

  test('shows all 6 built-in tool cards', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Tools")').click()
    // Wait for tools to load from API
    await expect(page.locator('main')).toContainText('Read file contents', { timeout: 10_000 })
    await expect(page.locator('main')).toContainText('Write content to a file')
    await expect(page.locator('main')).toContainText('Replace exact text')
    await expect(page.locator('main')).toContainText('Execute a shell command')
    await expect(page.locator('main')).toContainText('Control a headless browser')
    await expect(page.locator('main')).toContainText('Launch SubAgents')
  })

  test('shows Browser tool with action details', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Tools")').click()
    await expect(page.locator('main')).toContainText('browser', { timeout: 10_000 })
    await expect(page.locator('main')).toContainText('navigate')
  })

  test('shows Task tool with preset details', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Tools")').click()
    await expect(page.locator('main')).toContainText('task', { timeout: 10_000 })
    await expect(page.locator('main')).toContainText('explorer')
  })

  test('tool cards show parameter sections', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Tools")').click()
    // Wait for tools to load
    await expect(page.locator('main')).toContainText('PARAMETERS', { timeout: 10_000 })
  })

  test('tool cards show parameter JSON', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Tools")').click()
    // Wait for tools to load
    await expect(page.locator('main')).toContainText('PARAMETERS', { timeout: 10_000 })
    const paramBlocks = page.locator('main pre')
    const count = await paramBlocks.count()
    expect(count).toBeGreaterThanOrEqual(6)
  })

  test('shows 6 tool cards in grid', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Tools")').click()
    // Wait for tools to load
    await expect(page.locator('main')).toContainText('PARAMETERS', { timeout: 10_000 })
    // Each tool has a card with animate-fade-up class
    const cards = page.locator('main .card.animate-fade-up')
    await expect(cards).toHaveCount(6)
  })
})
