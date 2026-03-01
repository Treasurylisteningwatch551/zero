import { test, expect } from '@playwright/test'

test.describe('Config Page', () => {
  test('shows config heading', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Config")').click()
    await expect(page.locator('main h1')).toContainText('Config')
  })

  test('shows providers section with data', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Config")').click()
    await expect(page.locator('main h3:has-text("Providers")')).toBeVisible()
    // API data should load: openai-codex provider
    await expect(page.locator('main')).toContainText('openai-codex', { timeout: 10_000 })
  })

  test('shows models section with data', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Config")').click()
    await expect(page.locator('main h3:has-text("Models")')).toBeVisible()
    // Should show the model name
    await expect(page.locator('main')).toContainText('gpt-5.3-codex-medium', { timeout: 10_000 })
  })

  test('shows scheduled tasks section', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Config")').click()
    await expect(page.locator('main h3:has-text("Scheduled Tasks")')).toBeVisible()
  })

  test('shows fuse list section', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Config")').click()
    await expect(page.locator('main h3:has-text("Fuse List")')).toBeVisible()
  })

  test('shows default model badge', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Config")').click()
    await expect(page.locator('main span:has-text("Default")')).toBeVisible({ timeout: 10_000 })
  })
})
