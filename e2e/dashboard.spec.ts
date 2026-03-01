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

  test('shows ZeRo OS Ready card', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=ZeRo OS Ready')).toBeVisible()
  })

  test('status bar shows uptime', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Uptime')).toBeVisible({ timeout: 10_000 })
  })
})
