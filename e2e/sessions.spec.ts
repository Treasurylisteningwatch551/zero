import { test, expect } from '@playwright/test'

test.describe('Sessions Page', () => {
  test('shows sessions heading', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Sessions")').click()
    await expect(page.locator('main h1')).toContainText('Sessions')
  })

  test('shows filter buttons', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Sessions")').click()
    const filterArea = page.locator('main .flex.gap-2')
    await expect(filterArea.locator('button:has-text("All")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("Active")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("Completed")')).toBeVisible()
    await expect(filterArea.locator('button:has-text("Archived")')).toBeVisible()
  })

  test('has search input', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Sessions")').click()
    await expect(page.getByPlaceholder('Search sessions...')).toBeVisible()
  })

  test('filter buttons are clickable', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Sessions")').click()
    const filterArea = page.locator('main .flex.gap-2')
    await filterArea.locator('button:has-text("Active")').click()
    await expect(page.locator('main h1')).toContainText('Sessions')
  })

  test('session appears after chat', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')

    // Send a chat message to create a session
    await page.locator('aside button:has-text("Chat")').click()
    const input = page.getByPlaceholder('Send a message...')
    await input.fill('Say hello')
    await input.press('Enter')
    // Wait for reply to complete (no more "Thinking...")
    await expect(page.locator('text=Thinking...')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('text=Thinking...')).not.toBeVisible({ timeout: 45_000 })

    // Close drawer via X button (push layout, no backdrop)
    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    await drawer.locator('button').first().click()
    await page.locator('nav button:has-text("Sessions")').click()

    // Session should appear — check for session metrics in card
    await expect(page.locator('main')).toContainText('tool calls', { timeout: 5_000 })
  })
})
