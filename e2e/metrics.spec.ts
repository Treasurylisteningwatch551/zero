import { test, expect } from '@playwright/test'

test.describe('Metrics Page', () => {
  test('shows metrics heading', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await expect(page.locator('main h1')).toContainText('Metrics')
  })

  test('shows cost over time section', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await expect(page.locator('main h3:has-text("Cost Over Time")')).toBeVisible()
  })

  test('shows token usage section', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await expect(page.locator('main h3:has-text("Token Usage")')).toBeVisible()
  })

  test('shows model distribution section', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await expect(page.locator('main h3:has-text("Model Distribution")')).toBeVisible()
  })

  test('shows tool usage section', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await expect(page.locator('main h3:has-text("Tool Usage")')).toBeVisible()
  })
})
