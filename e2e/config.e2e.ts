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

  test('shows channels section', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Config")').click()
    await expect(page.locator('main h3:has-text("Channels")')).toBeVisible({ timeout: 10_000 })
  })

  test('shows channel names in channels section', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Config")').click()
    // Wait for channels section to load
    const channelsCard = page.locator('main .lg\\:col-span-2')
    await expect(channelsCard).toBeVisible({ timeout: 10_000 })
    await expect(channelsCard).toContainText('Channels')
    // All three channels should be visible in the channels card
    await expect(channelsCard).toContainText('web')
    await expect(channelsCard).toContainText('feishu')
    await expect(channelsCard).toContainText('telegram')
  })

  test('shows channel status indicators', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Config")').click()
    // At least web channel should show "online" in the channels card
    const channelsCard = page.locator('main .lg\\:col-span-2')
    await expect(channelsCard).toContainText('online', { timeout: 10_000 })
  })
})
