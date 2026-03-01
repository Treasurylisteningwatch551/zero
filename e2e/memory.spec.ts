import { test, expect } from '@playwright/test'

test.describe('Memory Page', () => {
  test('shows memory heading', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Memory")').click()
    await expect(page.locator('main h1')).toContainText('Memory')
  })

  test('shows type filter buttons', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Memory")').click()
    // Type filter buttons within main content
    const filterArea = page.locator('main .flex.flex-wrap.gap-1\\.5')
    await expect(filterArea.locator('button:has-text("All")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("session")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("incident")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("runbook")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("decision")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("note")')).toBeVisible()
  })

  test('has search input', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Memory")').click()
    await expect(page.getByPlaceholder('Search memories...')).toBeVisible()
  })

  test('shows detail panel placeholder', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Memory")').click()
    await expect(page.locator('main')).toContainText('Select a memory to view details')
  })

  test('type filter buttons are clickable', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Memory")').click()
    // Click a type filter button within main
    const filterArea = page.locator('main .flex.flex-wrap.gap-1\\.5')
    await filterArea.locator('button:has-text("session")').click()
    // Page should not crash
    await expect(page.locator('main h1')).toContainText('Memory')
  })
})
