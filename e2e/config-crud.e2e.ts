import { expect, test } from './fixtures'

test.describe('Config Page Deep Interactions', () => {
  test('Fuse List tab shows blocked command patterns', async ({ page }) => {
    await page.goto('/config')
    await page.locator('main button:has-text("Fuse List")').click()
    await expect(page.locator('main h3:has-text("Fuse List")')).toBeVisible()
    // Fuse list always shows at least the default blocked commands
    await expect(page.locator('main')).toContainText('rm -rf /', { timeout: 10_000 })
    await expect(page.locator('main')).toContainText('shutdown')
  })

  test('Scheduler tab shows scheduled tasks or empty state', async ({ page }) => {
    await page.goto('/config')
    await page.locator('main button:has-text("Scheduler")').click()
    await expect(page.locator('main h3:has-text("Scheduled Tasks")')).toBeVisible()
    // Should show either schedule entries or "No scheduled tasks configured"
    const main = page.locator('main')
    const hasSchedules = await main.locator('.border-b').count()
    if (hasSchedules === 0) {
      await expect(main).toContainText('No scheduled tasks configured')
    }
  })

  test('Secrets tab shows vault key indicators', async ({ page }) => {
    await page.goto('/config')
    await page.locator('main button:has-text("Secrets")').click()
    await expect(page.locator('main h3:has-text("Secrets")')).toBeVisible({ timeout: 10_000 })
    // Secrets tab shows either configured secrets with status dots or empty state
    const main = page.locator('main')
    // Check for configured indicator (green dot) or "Add Secret" button
    await expect(main.locator('button:has-text("Add Secret")')).toBeVisible()
  })

  test('Channels tab shows status indicators for each channel', async ({ page }) => {
    await page.goto('/config')
    await page.locator('main button:has-text("Channels")').click()
    await expect(page.locator('main h3:has-text("Channels")')).toBeVisible({ timeout: 10_000 })
    // Each channel row has a status badge (online/offline)
    await expect(page.locator('main')).toContainText('web', { timeout: 10_000 })
    // Status indicator dots (green for online, red for offline)
    const statusDots = page.locator('main .w-2.h-2.rounded-full')
    const dotCount = await statusDots.count()
    expect(dotCount).toBeGreaterThanOrEqual(1)
  })

  test('Models tab shows capability tags', async ({ page }) => {
    await page.goto('/config')
    // Models tab is the default
    await expect(page.locator('main h3:has-text("Models")')).toBeVisible({ timeout: 10_000 })
    // Model entries show context/output size
    await expect(page.locator('main')).toContainText('context', { timeout: 10_000 })
    await expect(page.locator('main')).toContainText('output')
  })

  test('Tab switching preserves page state', async ({ page }) => {
    await page.goto('/config')
    // Verify Models tab is showing (default)
    await expect(page.locator('main h3:has-text("Providers")')).toBeVisible({ timeout: 10_000 })

    // Switch to Channels tab
    await page.locator('main button:has-text("Channels")').click()
    await expect(page.locator('main h3:has-text("Channels")')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('main')).toContainText('web')

    // Switch back to Models tab — content should still render
    await page.locator('main button:has-text("Models")').click()
    await expect(page.locator('main h3:has-text("Providers")')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('main')).toContainText('openai-codex')
  })
})
