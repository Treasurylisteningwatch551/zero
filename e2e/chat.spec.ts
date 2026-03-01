import { test, expect } from '@playwright/test'

test.describe('Chat Drawer', () => {
  test('opens and closes chat drawer', async ({ page }) => {
    await page.goto('/')
    // Click the Chat button in sidebar
    await page.locator('aside button:has-text("Chat")').click()
    // Drawer should appear with placeholder text
    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    await expect(drawer).toBeVisible()
    await expect(drawer).toContainText('Send a message to interact with ZeRo OS')
    // Close via X button (first button in drawer header)
    await drawer.locator('button').first().click()
    await expect(drawer).not.toBeVisible()
  })

  test('closes chat drawer via backdrop click', async ({ page }) => {
    await page.goto('/')
    await page.locator('aside button:has-text("Chat")').click()
    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    await expect(drawer).toBeVisible()
    // Click the backdrop
    await page.locator('.fixed.inset-0.bg-black\\/40').click()
    await expect(drawer).not.toBeVisible()
  })

  test('can type a message', async ({ page }) => {
    await page.goto('/')
    await page.locator('aside button:has-text("Chat")').click()
    const input = page.getByPlaceholder('Send a message...')
    await input.fill('Hello')
    await expect(input).toHaveValue('Hello')
  })

  test('send button disabled when empty', async ({ page }) => {
    await page.goto('/')
    await page.locator('aside button:has-text("Chat")').click()
    // The send button should be disabled when input is empty
    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    const sendBtn = drawer.locator('button[disabled]')
    await expect(sendBtn).toBeVisible()
  })

  test('sends message and receives AI reply', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    await page.locator('aside button:has-text("Chat")').click()

    const input = page.getByPlaceholder('Send a message...')
    await input.fill('What is 2+2? Answer with just the number.')
    await input.press('Enter')

    // User message should appear in the drawer
    const drawer = page.locator('.fixed.right-0.top-0.h-full.w-\\[360px\\]')
    await expect(drawer).toContainText('What is 2+2?')

    // Should show loading indicator
    await expect(drawer.locator('text=Thinking...')).toBeVisible({ timeout: 5_000 })

    // Wait for AI reply (real API call)
    await expect(drawer.locator('text=Thinking...')).not.toBeVisible({ timeout: 45_000 })

    // Should contain the answer "4" somewhere in the reply
    await expect(drawer).toContainText('4')
  })
})
