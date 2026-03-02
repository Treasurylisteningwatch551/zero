import { test, expect } from '@playwright/test'

test.describe('Responsive Design', () => {
  test('mobile viewport shows TabBar at bottom', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    // Mobile TabBar is a fixed nav at the bottom
    const tabBar = page.locator('nav.fixed.bottom-0')
    await expect(tabBar).toBeVisible()
    // TabBar should have navigation items
    await expect(tabBar).toContainText('Dashboard')
    await expect(tabBar).toContainText('Sessions')
  })

  test('mobile viewport hides sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    // Sidebar should not be rendered on mobile (isMobile hides it)
    await page.waitForTimeout(1000)
    const sidebarCount = await page.locator('aside').count()
    expect(sidebarCount).toBe(0)
  })

  test('tablet viewport shows Dashboard correctly', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
    await expect(page.locator('main h1')).toContainText('Dashboard')
  })

  test('desktop viewport shows full sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible()
    await expect(sidebar).toContainText('ZeRo')
    // Full sidebar should show navigation text
    await expect(sidebar).toContainText('Dashboard')
    await expect(sidebar).toContainText('Sessions')
  })

  test('mobile viewport does not show sidebar Chat button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    // On mobile, sidebar is hidden so Chat button is not accessible from sidebar
    // TabBar does not include Chat
    await page.waitForTimeout(1000)
    const sidebarCount = await page.locator('aside').count()
    expect(sidebarCount).toBe(0)
    // TabBar should be visible
    const tabBar = page.locator('nav.fixed.bottom-0')
    await expect(tabBar).toBeVisible()
  })

  test('sessions page is responsive', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/sessions')
    await expect(page.locator('main h1')).toContainText('Sessions')
  })

  test('config page tabs work on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/config')
    await expect(page.locator('main h1')).toContainText('Config')
    // Tab buttons should be visible and clickable
    await page.locator('main button:has-text("Channels")').click()
    await expect(page.locator('main h3:has-text("Channels")')).toBeVisible({ timeout: 10_000 })
  })
})
