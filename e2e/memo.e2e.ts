import { expect, test } from '@playwright/test'

test.describe('Memo Page', () => {
  test('shows memo heading', async ({ page }) => {
    await page.goto('/memo')
    await expect(page.locator('main h1')).toContainText('Memo')
  })

  test('loads CodeMirror editor', async ({ page }) => {
    await page.goto('/memo')
    // CodeMirror renders as .cm-editor
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })
    // The editable area is .cm-content
    await expect(page.locator('.cm-content')).toBeVisible()
  })

  test('shows status bar with word count', async ({ page }) => {
    await page.goto('/memo')
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })
    // Status bar shows word count and save status
    await expect(page.locator('main')).toContainText('words')
    await expect(page.locator('main')).toContainText('Saved')
  })

  test('shows Save button in header', async ({ page }) => {
    await page.goto('/memo')
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('main button:has-text("Save")')).toBeVisible()
  })

  test('Save button is disabled when no changes', async ({ page }) => {
    await page.goto('/memo')
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })
    // Save button should be disabled (opacity-40)
    const saveBtn = page.locator('main button:has-text("Save")')
    await expect(saveBtn).toBeDisabled()
  })

  test('editing text enables Save button', async ({ page }) => {
    await page.goto('/memo')
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })
    // Type into CodeMirror
    await page.locator('.cm-content').click()
    await page.keyboard.type('E2E test content')
    // Status should change to Unsaved
    await expect(page.locator('main')).toContainText('Unsaved', { timeout: 5_000 })
  })

  test('shows line numbers in editor', async ({ page }) => {
    await page.goto('/memo')
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })
    // Line numbers are rendered in .cm-gutters
    await expect(page.locator('.cm-gutters')).toBeVisible()
  })

  test('shows skeleton loader while loading', async ({ page }) => {
    await page.route('**/api/memo', async (route) => {
      await new Promise((r) => setTimeout(r, 1000))
      await route.continue()
    })
    await page.goto('/memo')
    await expect(page.locator('main .skeleton').first()).toBeVisible()
  })

  test('content persists after navigation', async ({ page }) => {
    await page.goto('/memo')
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })

    // Type new content
    await page.locator('.cm-content').click()
    // Select all existing content and replace
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('# Memo\n\n## Goals\n- E2E test goal\n')

    // Save via button
    await page.locator('main button:has-text("Save")').click()
    // Wait for save to complete
    await expect(page.locator('main')).toContainText('Saved', { timeout: 5_000 })

    // Navigate away and come back
    await page.goto('/')
    await expect(page.locator('main h1')).toContainText('Dashboard')
    await page.goto('/memo')

    // Verify persisted content
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.cm-content')).toContainText('E2E test goal', { timeout: 5_000 })
  })
})
