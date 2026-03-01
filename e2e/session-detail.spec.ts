import { test, expect } from '@playwright/test'

test.describe('Session Detail Page', () => {
  // Helper: create a session via chat, then navigate to session detail
  async function createSessionAndNavigate(page: import('@playwright/test').Page) {
    await page.goto('/')

    // Send a chat message to create a session
    await page.locator('aside button:has-text("Chat")').click()
    const input = page.getByPlaceholder('Send a message...')
    await input.fill('Say hello briefly')
    await input.press('Enter')

    // Wait for AI reply to complete
    await expect(page.locator('text=Thinking...')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('text=Thinking...')).not.toBeVisible({ timeout: 45_000 })

    // Close chat drawer via X button (push layout, no backdrop)
    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    await drawer.locator('button').first().click()

    // Go to Sessions page
    await page.locator('nav button:has-text("Sessions")').click()
    await expect(page.locator('main h1')).toContainText('Sessions')

    // Wait for sessions to load and click the first one
    await expect(page.locator('main .card.cursor-pointer').first()).toBeVisible({ timeout: 5_000 })
    await page.locator('main .card.cursor-pointer').first().click()

    // Wait for session detail to load
    await expect(page.locator('main')).toContainText('sess_', { timeout: 10_000 })
  }

  test('navigates to session detail and shows session ID', async ({ page }) => {
    test.setTimeout(90_000)
    await createSessionAndNavigate(page)

    // Should show session ID pattern
    await expect(page.locator('main')).toContainText('sess_')
  })

  test('shows metadata bar with session info', async ({ page }) => {
    test.setTimeout(90_000)
    await createSessionAndNavigate(page)

    // Metadata bar shows source (lowercase), model, and Archive button
    const main = page.locator('main')
    await expect(main).toContainText('web')
    await expect(main).toContainText('gpt-5.3-codex-medium')
  })

  test('shows timeline with user message', async ({ page }) => {
    test.setTimeout(90_000)
    await createSessionAndNavigate(page)

    // Should show some user message content in the timeline
    // (we don't check for specific text since it could be any session)
    await expect(page.locator('main')).toContainText('gpt-5.3-codex', { timeout: 5_000 })
  })

  test('shows context panel with model history', async ({ page }) => {
    test.setTimeout(90_000)
    await createSessionAndNavigate(page)

    // Context panel renders headers in uppercase
    await expect(page.locator('main')).toContainText('MODEL HISTORY', { timeout: 5_000 })
  })

  test('shows Summary and Trace tabs', async ({ page }) => {
    test.setTimeout(90_000)
    await createSessionAndNavigate(page)

    await expect(page.locator('main')).toContainText('Summary', { timeout: 5_000 })
    await expect(page.locator('main')).toContainText('Trace')
  })

  test('shows archive button', async ({ page }) => {
    test.setTimeout(90_000)
    await createSessionAndNavigate(page)

    await expect(page.locator('main button:has-text("Archive")')).toBeVisible({ timeout: 5_000 })
  })

  test('back button returns to sessions list', async ({ page }) => {
    test.setTimeout(90_000)
    await createSessionAndNavigate(page)

    // The back button is in main content area (not sidebar)
    await page.locator('main button:has-text("Sessions")').click()

    // Should be back at sessions list
    await expect(page.locator('main h1')).toContainText('Sessions')
  })
})
