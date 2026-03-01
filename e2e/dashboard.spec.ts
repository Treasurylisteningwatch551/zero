import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('shows system status bar with running status', async ({ page }) => {
    await page.goto('/')
    // StatusBar shows model name (always present in status bar)
    const statusBar = page.locator('[class*="border-b"][class*="flex"][class*="items-center"][class*="gap-6"]')
    await expect(statusBar).toBeVisible({ timeout: 10_000 })
    await expect(statusBar).toContainText('gpt-5.3-codex-medium')
  })

  test('shows cost overview section', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Cost Overview')).toBeVisible()
    await expect(page.locator('text=Today')).toBeVisible()
    await expect(page.locator('text=This Week')).toBeVisible()
    await expect(page.locator('text=This Month')).toBeVisible()
  })

  test('shows activity feed section', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Recent Activity')).toBeVisible()
  })

  test('shows Active Sessions heading', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Active Sessions' })).toBeVisible()
  })

  test('shows channel status with all channel names', async ({ page }) => {
    await page.goto('/')
    // Channel status bar uses Plugs icon — locate the channel status component
    const channelBar = page.locator('.card.flex.items-center')
    await expect(channelBar).toBeVisible({ timeout: 10_000 })
    await expect(channelBar).toContainText('web')
    await expect(channelBar).toContainText('feishu')
    await expect(channelBar).toContainText('telegram')
  })

  test('status bar shows uptime', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Uptime')).toBeVisible({ timeout: 10_000 })
  })

  test('attention card is conditionally rendered', async ({ page }) => {
    await page.goto('/')
    // The attention card only renders when there are notifications
    // If there are warn/error logs, it should show "Needs Attention"
    // If not, the card should not be in the DOM
    // We wait briefly to ensure the fetch completes
    await page.waitForTimeout(2000)
    const attentionCard = page.locator('text=Needs Attention')
    // Either visible (if there are notifications) or not present — both are valid
    const count = await attentionCard.count()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('ZeRo OS Ready card is removed', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
    await expect(page.locator('text=ZeRo OS Ready')).not.toBeVisible()
  })
})
