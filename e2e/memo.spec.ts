import { test, expect } from '@playwright/test'

test.describe('Memo Page', () => {
  test('shows memo heading', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Memo', exact: true }).click()
    await expect(page.locator('main h1')).toContainText('Memo')
  })

  test('loads memo content from API', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Memo', exact: true }).click()
    // Should load content — wait for the card to have text inside
    await expect(page.locator('main .card')).not.toContainText('Loading', { timeout: 5_000 })
  })

  test('switches to edit mode', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Memo', exact: true }).click()
    await page.waitForTimeout(500) // wait for content to load
    await page.locator('main button:has-text("Edit")').click()
    // Should show textarea
    await expect(page.locator('textarea')).toBeVisible()
    // Should show Preview and Save buttons
    await expect(page.locator('main button:has-text("Preview")')).toBeVisible()
    await expect(page.locator('main button:has-text("Save")')).toBeVisible()
  })

  test('edits and saves memo persistently', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Memo', exact: true }).click()

    // Wait for initial load
    await page.waitForTimeout(1000)

    // Enter edit mode
    await page.locator('main button:has-text("Edit")').click()

    // Type in textarea
    const textarea = page.locator('textarea')
    await textarea.fill('# Memo\n\n## Goals\n- E2E test goal\n\n## Needs User Action\n')

    // Click Save
    await page.locator('main button:has-text("Save")').click()
    await page.waitForTimeout(500)

    // Navigate away and come back
    await page.locator('nav button:has-text("Dashboard")').click()
    await expect(page.locator('main h1')).toContainText('Dashboard')

    await page.getByRole('button', { name: 'Memo', exact: true }).click()
    // Verify persisted content
    await expect(page.locator('main')).toContainText('E2E test goal', { timeout: 5_000 })
  })
})
