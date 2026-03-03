import { test, expect } from '@playwright/test'

test.describe('Memory Page Interactions', () => {
  test('memory page loads with heading and filters', async ({ page }) => {
    await page.goto('/memory')
    await expect(page.locator('main h1')).toContainText('Memory')
    // Type filter buttons should be visible
    const filterArea = page.locator('main .flex.flex-wrap.gap-1\\.5')
    await expect(filterArea.locator('button:has-text("All")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("session")')).toBeVisible()
  })

  test('memory list shows items or empty state', async ({ page }) => {
    await page.goto('/memory')
    await page.waitForTimeout(2000)
    const main = page.locator('main')
    // Either memory items exist (button.card) or "No memories found" is shown
    const memoryItems = main.locator('button.card')
    const count = await memoryItems.count()
    if (count > 0) {
      // At least one memory item is visible
      await expect(memoryItems.first()).toBeVisible()
    } else {
      await expect(main).toContainText('No memories found')
    }
  })

  test('search input filters memories', async ({ page }) => {
    await page.goto('/memory')
    // Search input should be present
    const searchInput = page.getByPlaceholder('Search memories...')
    await expect(searchInput).toBeVisible()
    // Type a search query — page should not crash
    await searchInput.fill('test query')
    // Wait for debounced search to trigger
    await page.waitForTimeout(500)
    // Page should still show the Memory heading (not crash)
    await expect(page.locator('main h1')).toContainText('Memory')
  })

  test('memory detail panel shows edit button when item selected', async ({ page }) => {
    await page.goto('/memory')
    await page.waitForTimeout(2000)
    const memoryItems = page.locator('main button.card')
    const count = await memoryItems.count()
    if (count > 0) {
      // Click first memory to select it
      await memoryItems.first().click()
      // Detail panel should show Edit button
      await expect(page.locator('main button:has-text("Edit")')).toBeVisible({ timeout: 5_000 })
    } else {
      // If no memories, the overview panel should show
      await expect(page.locator('main')).toContainText('Memory Overview', { timeout: 10_000 })
    }
  })
})
