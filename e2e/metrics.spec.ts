import { test, expect } from '@playwright/test'

test.describe('Metrics Page', () => {
  test('shows metrics heading', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await expect(page.locator('main h1')).toContainText('Metrics')
  })

  test('has 3 tab buttons: Cost, Operations, Health', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await expect(page.locator('main button:has-text("Cost")')).toBeVisible()
    await expect(page.locator('main button:has-text("Operations")')).toBeVisible()
    await expect(page.locator('main button:has-text("Health")')).toBeVisible()
  })

  test('has time range selector: 7d, 30d, 90d', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await expect(page.locator('main button:has-text("7d")')).toBeVisible()
    await expect(page.locator('main button:has-text("30d")')).toBeVisible()
    await expect(page.locator('main button:has-text("90d")')).toBeVisible()
  })

  test('Cost tab shows expected sections', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    // Cost is default tab
    await expect(page.locator('main h3:has-text("Cost Trend")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Token Usage")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Model Distribution")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Cache Hit Rate")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Detail Records")')).toBeVisible()
  })

  test('Operations tab shows expected sections', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await page.locator('main button:has-text("Operations")').click()
    await expect(page.locator('main h3:has-text("Task Completion Rate")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Tool Call Distribution")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Avg Execution Time")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Tool Error Rate")')).toBeVisible()
  })

  test('Health tab shows expected sections', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    await page.locator('main button:has-text("Health")').click()
    await expect(page.locator('main h3:has-text("Self-Repair Stats")')).toBeVisible()
    await expect(page.locator('main h3:has-text("System Availability")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Fuse Events")')).toBeVisible()
  })

  test('tab switching hides previous content', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    // Start on Cost tab
    await expect(page.locator('main h3:has-text("Cost Trend")')).toBeVisible()
    // Switch to Operations
    await page.locator('main button:has-text("Operations")').click()
    await expect(page.locator('main h3:has-text("Cost Trend")')).not.toBeVisible()
    await expect(page.locator('main h3:has-text("Task Completion Rate")')).toBeVisible()
  })

  test('time range buttons are clickable', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav button:has-text("Metrics")').click()
    const btn7d = page.locator('main button:has-text("7d")')
    await btn7d.click()
    // Active tab should have accent color class
    await expect(btn7d).toHaveClass(/text-\[var\(--color-accent\)\]/)
  })
})
