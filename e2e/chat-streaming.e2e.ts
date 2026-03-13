import { expect, test } from '@playwright/test'

test.describe('Chat Streaming Interactions', () => {
  test('send message and receive AI response', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    await page.locator('aside button').filter({ hasText: 'Chat' }).click()

    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    await expect(drawer).toBeVisible()

    const textarea = page.getByPlaceholder('Send a message...')
    await textarea.fill('What is 3+5? Answer with just the number.')
    await textarea.press('Enter')

    // User message should appear
    await expect(drawer).toContainText('What is 3+5?')

    // Bounce dots loading indicator should appear
    await expect(drawer.locator('.typing-dot').first()).toBeVisible({ timeout: 5_000 })

    // Wait for reply to complete
    await expect(drawer.locator('.typing-dot').first()).not.toBeVisible({ timeout: 45_000 })

    // Should contain the answer
    await expect(drawer).toContainText('8')
  })

  test('chat history persists across messages in same session', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await page.locator('aside button').filter({ hasText: 'Chat' }).click()

    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    const textarea = page.getByPlaceholder('Send a message...')

    // Send first message
    await textarea.fill('Remember the word "pineapple". Reply with just OK.')
    await textarea.press('Enter')
    await expect(drawer.locator('.typing-dot').first()).toBeVisible({ timeout: 5_000 })
    await expect(drawer.locator('.typing-dot').first()).not.toBeVisible({ timeout: 45_000 })

    // First message should still be visible
    await expect(drawer).toContainText('pineapple')

    // Send second message
    await textarea.fill('What word did I ask you to remember? Reply with just the word.')
    await textarea.press('Enter')
    await expect(drawer.locator('.typing-dot').first()).toBeVisible({ timeout: 5_000 })
    await expect(drawer.locator('.typing-dot').first()).not.toBeVisible({ timeout: 45_000 })

    // Both messages should be in the chat history
    await expect(drawer).toContainText('pineapple')
  })

  test('long response completes successfully', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await page.locator('aside button').filter({ hasText: 'Chat' }).click()

    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    const textarea = page.getByPlaceholder('Send a message...')

    await textarea.fill('List the numbers 1 through 10, one per line.')
    await textarea.press('Enter')

    // Wait for loading to start and finish
    await expect(drawer.locator('.typing-dot').first()).toBeVisible({ timeout: 5_000 })
    await expect(drawer.locator('.typing-dot').first()).not.toBeVisible({ timeout: 60_000 })

    // Response should contain multiple numbers indicating a complete response
    await expect(drawer).toContainText('1')
    await expect(drawer).toContainText('10')
  })

  test('chat drawer shows model name in header', async ({ page }) => {
    await page.goto('/')
    await page.locator('aside button').filter({ hasText: 'Chat' }).click()

    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    await expect(drawer).toBeVisible()

    // Header shows "Web Channel" and model name
    await expect(drawer).toContainText('Web Channel')
    await expect(drawer).toContainText('gpt-5.3-codex-medium', { timeout: 10_000 })
  })
})
