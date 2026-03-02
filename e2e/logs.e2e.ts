import { test, expect } from '@playwright/test'

test.describe('Logs Page', () => {
  test('shows logs heading', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Logs")').click()
    await expect(page.locator('main h1')).toContainText('Logs')
  })

  test('shows filter controls', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Logs")').click()
    // Search input
    await expect(page.getByPlaceholder('Filter logs...')).toBeVisible()
    // Time range select
    await expect(page.locator('main select')).toBeVisible()
    // Log type tabs
    await expect(page.locator('main button:has-text("operations")')).toBeVisible()
    await expect(page.locator('main button:has-text("requests")')).toBeVisible()
    await expect(page.locator('main button:has-text("snapshots")')).toBeVisible()
    await expect(page.locator('main button:has-text("trace")')).toBeVisible()
  })

  test('shows level toggle buttons', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Logs")').click()
    // Level toggles are buttons with dot indicators
    await expect(page.locator('main button:has-text("info")')).toBeVisible()
    await expect(page.locator('main button:has-text("warn")')).toBeVisible()
    await expect(page.locator('main button:has-text("error")')).toBeVisible()
  })

  test('shows table headers', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Logs")').click()
    // Operations type shows Time, Level, Session, Tool, Input, Output headers
    await expect(page.locator('main')).toContainText('Time')
    await expect(page.locator('main')).toContainText('Level')
    await expect(page.locator('main')).toContainText('Session')
  })

  test('log type tabs switch content', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Logs")').click()
    // Switch to requests type
    await page.locator('main button:has-text("requests")').click()
    // Should show requests-specific columns
    await expect(page.locator('main')).toContainText('Model')
    await expect(page.locator('main')).toContainText('Tokens')
    await expect(page.locator('main')).toContainText('Cost')
  })

  test('time range filter changes selection', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Logs")').click()
    const timeSelect = page.locator('main select')
    await timeSelect.selectOption('24h')
    await expect(timeSelect).toHaveValue('24h')
  })

  test('Live button toggles live mode', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Logs")').click()
    const liveBtn = page.locator('main button:has-text("Live")')
    await expect(liveBtn).toBeVisible()
    await liveBtn.click()
    // Live mode should be active (cyan highlight)
    await expect(liveBtn).toHaveClass(/text-cyan-400/)
  })

  test('custom time range shows date inputs when selected', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Logs")').click()
    const timeSelect = page.locator('main select')
    await timeSelect.selectOption('custom')
    // Custom range inputs should appear
    await expect(page.locator('main input[type="datetime-local"]').first()).toBeVisible()
    await expect(page.locator('main input[type="datetime-local"]').last()).toBeVisible()
    await expect(page.locator('main')).toContainText('From')
    await expect(page.locator('main')).toContainText('To')
  })

  test('trace tab shows trace-specific columns', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Logs")').click()
    await page.locator('main button:has-text("trace")').click()
    await expect(page.locator('main')).toContainText('Summary')
    await expect(page.locator('main')).toContainText('Duration')
  })
})
