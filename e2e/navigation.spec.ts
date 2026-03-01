import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('shows ZeRo logo in sidebar', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('aside')).toContainText('ZeRo')
  })

  test('has 8 navigation items', async ({ page }) => {
    await page.goto('/')
    const navButtons = page.locator('nav button')
    await expect(navButtons).toHaveCount(8)
  })

  test('default page is Dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('main h1')).toContainText('Dashboard')
  })

  const navItems = [
    { name: 'Sessions', heading: 'Sessions' },
    { name: 'Memory', heading: 'Memory' },
    { name: 'Memo', heading: 'Memo' },
    { name: 'Tools', heading: 'Tools' },
    { name: 'Logs', heading: 'Logs' },
    { name: 'Config', heading: 'Config' },
    { name: 'Metrics', heading: 'Metrics' },
  ]

  for (const item of navItems) {
    test(`navigates to ${item.name} page`, async ({ page }) => {
      await page.goto('/')
      // Use exact match to avoid "Memory" matching "Memo"
      await page.getByRole('button', { name: item.name, exact: true }).click()
      await expect(page.locator('main h1')).toContainText(item.heading)
    })
  }

  test('navigates back to Dashboard', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Sessions")').click()
    await expect(page.locator('main h1')).toContainText('Sessions')
    await page.locator('nav button:has-text("Dashboard")').click()
    await expect(page.locator('main h1')).toContainText('Dashboard')
  })

  test('sidebar shows Running status indicator', async ({ page }) => {
    await page.goto('/')
    const sidebar = page.locator('aside')
    await expect(sidebar).toContainText('Running')
  })

  test('sidebar shows current model name', async ({ page }) => {
    await page.goto('/')
    const sidebar = page.locator('aside')
    await expect(sidebar).toContainText('gpt-5.3-codex-medium')
  })

  test('sidebar shows version info', async ({ page }) => {
    await page.goto('/')
    const sidebar = page.locator('aside')
    await expect(sidebar).toContainText('v0.1 stable')
  })

  test('sidebar has Chat button', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('aside button:has-text("Chat")')).toBeVisible()
  })

  test('active page has highlighted nav item', async ({ page }) => {
    await page.goto('/')
    // Dashboard should be highlighted with accent border
    const dashboardBtn = page.locator('nav button:has-text("Dashboard")')
    await expect(dashboardBtn).toHaveClass(/border-l-2/)
  })
})
