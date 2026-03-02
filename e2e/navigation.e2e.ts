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
    { name: 'Sessions', path: '/sessions', heading: 'Sessions' },
    { name: 'Memory', path: '/memory', heading: 'Memory' },
    { name: 'Memo', path: '/memo', heading: 'Memo' },
    { name: 'Tools', path: '/tools', heading: 'Tools' },
    { name: 'Logs', path: '/logs', heading: 'Logs' },
    { name: 'Config', path: '/config', heading: 'Config' },
    { name: 'Metrics', path: '/metrics', heading: 'Metrics' },
  ]

  for (const item of navItems) {
    test(`navigates to ${item.name} page via URL`, async ({ page }) => {
      await page.goto(item.path)
      await expect(page.locator('main h1')).toContainText(item.heading)
    })
  }

  for (const item of navItems) {
    test(`navigates to ${item.name} page via sidebar click`, async ({ page }) => {
      await page.goto('/')
      await page.getByRole('button', { name: item.name, exact: true }).click()
      await expect(page.locator('main h1')).toContainText(item.heading)
      // URL should update via TanStack Router
      await expect(page).toHaveURL(new RegExp(item.path))
    })
  }

  test('navigates back to Dashboard', async ({ page }) => {
    await page.goto('/sessions')
    await expect(page.locator('main h1')).toContainText('Sessions')
    await page.locator('nav button').filter({ hasText: 'Dashboard' }).click()
    await expect(page.locator('main h1')).toContainText('Dashboard')
    await expect(page).toHaveURL('/')
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
    await expect(page.locator('aside button').filter({ hasText: 'Chat' })).toBeVisible()
  })

  test('active page has highlighted nav item', async ({ page }) => {
    await page.goto('/')
    // Dashboard should be highlighted with accent glow background
    const dashboardBtn = page.locator('nav button').filter({ hasText: 'Dashboard' })
    await expect(dashboardBtn).toHaveClass(/border-l-2/)
  })
})
