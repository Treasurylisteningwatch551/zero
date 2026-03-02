import { test, expect } from '@playwright/test'

test.describe('Skeleton Loaders', () => {
  test('config page shows skeletons during loading', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
      await new Promise((r) => setTimeout(r, 2000))
      await route.continue()
    })
    await page.goto('/config')
    // Skeleton elements should appear during loading
    await expect(page.locator('.skeleton').first()).toBeVisible({ timeout: 3_000 })
  })

  test('tools page shows skeletons during loading', async ({ page }) => {
    await page.route('**/api/tools', async (route) => {
      await new Promise((r) => setTimeout(r, 2000))
      await route.continue()
    })
    await page.goto('/tools')
    await expect(page.locator('.skeleton').first()).toBeVisible({ timeout: 3_000 })
  })

  test('memo page shows skeletons during loading', async ({ page }) => {
    await page.route('**/api/memo', async (route) => {
      await new Promise((r) => setTimeout(r, 2000))
      await route.continue()
    })
    await page.goto('/memo')
    await expect(page.locator('.skeleton').first()).toBeVisible({ timeout: 3_000 })
  })

  test('memory page shows skeletons during loading', async ({ page }) => {
    await page.route('**/api/memory*', async (route) => {
      await new Promise((r) => setTimeout(r, 2000))
      await route.continue()
    })
    await page.goto('/memory')
    await expect(page.locator('.skeleton').first()).toBeVisible({ timeout: 3_000 })
  })

  test('sessions page shows skeletons during loading', async ({ page }) => {
    await page.route('**/api/sessions*', async (route) => {
      await new Promise((r) => setTimeout(r, 2000))
      await route.continue()
    })
    await page.goto('/sessions')
    await expect(page.locator('.skeleton').first()).toBeVisible({ timeout: 3_000 })
  })

  test('logs page shows skeletons during loading', async ({ page }) => {
    await page.route('**/api/logs*', async (route) => {
      await new Promise((r) => setTimeout(r, 2000))
      await route.continue()
    })
    await page.goto('/logs')
    await expect(page.locator('.skeleton').first()).toBeVisible({ timeout: 3_000 })
  })

  test('skeletons disappear after data loads', async ({ page }) => {
    await page.goto('/config')
    // Wait for loading to complete
    await expect(page.locator('main h3:has-text("Providers")')).toBeVisible({ timeout: 10_000 })
    // Skeleton elements should be gone
    const skeletonCount = await page.locator('main .skeleton').count()
    expect(skeletonCount).toBe(0)
  })

  test('"Loading..." text is not used anywhere', async ({ page }) => {
    // Verify no page uses "Loading..." text (replaced by skeleton loaders)
    const pages = ['/config', '/tools', '/memo', '/memory', '/sessions', '/logs']
    for (const p of pages) {
      await page.route('**/api/**', async (route) => {
        await new Promise((r) => setTimeout(r, 500))
        await route.continue()
      })
      await page.goto(p)
      // During loading, "Loading..." text should NOT appear (skeletons instead)
      const loadingText = page.locator('main').filter({ hasText: /^Loading\.\.\.$/ })
      const count = await loadingText.count()
      // Allow 0 because data may load fast, but skeleton should be there, not Loading...
      expect(count).toBe(0)
    }
  })
})
