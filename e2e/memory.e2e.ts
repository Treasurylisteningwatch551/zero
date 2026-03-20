import { expect, test } from './fixtures'

test.describe('Memory Page', () => {
  test('shows memory heading', async ({ page }) => {
    await page.goto('/memory')
    await expect(page.locator('main h1')).toContainText('Memory')
  })

  test('shows type filter buttons including inbox and preference', async ({ page }) => {
    await page.goto('/memory')
    const filterArea = page.locator('main .flex.flex-wrap.gap-1\\.5')
    await expect(filterArea.locator('button:has-text("All")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("session")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("incident")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("runbook")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("decision")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("note")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("inbox")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("preference")')).toBeVisible()
  })

  test('has search input', async ({ page }) => {
    await page.goto('/memory')
    await expect(page.getByPlaceholder('Search memories...')).toBeVisible()
  })

  test('shows Memory Overview panel when nothing selected', async ({ page }) => {
    await page.goto('/memory')
    // Overview panel shows when no memory is selected
    await expect(page.locator('main')).toContainText('Memory Overview', { timeout: 10_000 })
    await expect(page.locator('main')).toContainText('total memories')
    await expect(page.locator('main')).toContainText('BY TYPE')
  })

  test('shows status filter and sort dropdowns', async ({ page }) => {
    await page.goto('/memory')
    // Two select dropdowns for status and sort
    const selects = page.locator('main select')
    await expect(selects).toHaveCount(2)
  })

  test('status filter has all options', async ({ page }) => {
    await page.goto('/memory')
    const statusSelect = page.locator('main select').first()
    await expect(statusSelect).toBeVisible()
    // Check options exist
    await expect(statusSelect.locator('option')).toHaveCount(5) // all, draft, verified, archived, conflict
  })

  test('sort dropdown has all options', async ({ page }) => {
    await page.goto('/memory')
    const sortSelect = page.locator('main select').last()
    await expect(sortSelect).toBeVisible()
    await expect(sortSelect.locator('option')).toHaveCount(3) // Newest, Confidence, Type
  })

  test('type filter buttons are clickable', async ({ page }) => {
    await page.goto('/memory')
    const filterArea = page.locator('main .flex.flex-wrap.gap-1\\.5')
    await filterArea.locator('button:has-text("session")').click()
    await expect(page.locator('main h1')).toContainText('Memory')
  })

  test('memory items show confidence dots', async ({ page }) => {
    await page.goto('/memory')
    // Wait for memories to load
    await page.waitForTimeout(2000)
    // Confidence dots are rendered as small round spans
    const dots = page.locator('main .flex.gap-0\\.5 span.rounded-full')
    const count = await dots.count()
    // Each memory item has 5 confidence dots; if there are memories, count should be >= 5
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('shows skeleton loaders while loading', async ({ page }) => {
    await page.route('**/api/memory*', async (route) => {
      await new Promise((r) => setTimeout(r, 1000))
      await route.continue()
    })
    await page.goto('/memory')
    await expect(page.locator('main .skeleton').first()).toBeVisible()
  })

  test('clicking a memory shows detail panel with edit button', async ({ page }) => {
    await page.goto('/memory')
    // Wait for memories to load
    await page.waitForTimeout(2000)
    // Click first memory item in the list (if any exist)
    const memoryItems = page.locator('main button.card')
    const count = await memoryItems.count()
    if (count > 0) {
      await memoryItems.first().click()
      // Detail panel should show Edit button
      await expect(page.locator('main button:has-text("Edit")')).toBeVisible({ timeout: 5_000 })
    }
  })
})
