import { test, expect } from '@playwright/test'

test.describe('Metrics Page', () => {
  test('shows metrics heading', async ({ page }) => {
    await page.goto('/metrics')
    await expect(page.locator('main h1')).toContainText('Metrics')
  })

  test('has 3 tab buttons: Cost, Operations, Health', async ({ page }) => {
    await page.goto('/metrics')
    await expect(page.locator('main button:has-text("Cost")')).toBeVisible()
    await expect(page.locator('main button:has-text("Operations")')).toBeVisible()
    await expect(page.locator('main button:has-text("Health")')).toBeVisible()
  })

  test('has time range selector: 7d, 30d, 90d, Custom', async ({ page }) => {
    await page.goto('/metrics')
    await expect(page.locator('main button:has-text("7d")')).toBeVisible()
    await expect(page.locator('main button:has-text("30d")')).toBeVisible()
    await expect(page.locator('main button:has-text("90d")')).toBeVisible()
    await expect(page.locator('main button:has-text("Custom")')).toBeVisible()
  })

  test('Cost tab shows expected sections', async ({ page }) => {
    await page.goto('/metrics')
    // Cost is default tab
    await expect(page.locator('main h3:has-text("Cost Trend")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Token Usage")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Model Distribution")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Cache Hit Rate")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Detail Records")')).toBeVisible()
  })

  test('Operations tab shows expected sections', async ({ page }) => {
    await page.goto('/metrics')
    await page.locator('main button:has-text("Operations")').click()
    await expect(page.locator('main h3:has-text("Task Completion Rate")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Tool Call Distribution")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Avg Execution Time")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Tool Error Rate")')).toBeVisible()
  })

  test('Health tab shows expected sections', async ({ page }) => {
    await page.goto('/metrics')
    await page.locator('main button:has-text("Health")').click()
    await expect(page.locator('main h3:has-text("Self-Repair Stats")')).toBeVisible()
    await expect(page.locator('main h3:has-text("System Availability")')).toBeVisible()
    await expect(page.locator('main h3:has-text("Fuse Events")')).toBeVisible()
  })

  test('Health tab shows 28px stat cards', async ({ page }) => {
    await page.goto('/metrics')
    await page.locator('main button:has-text("Health")').click()
    // Stat cards use text-[28px] for the value
    await expect(page.locator('main')).toContainText('Total Repairs', { timeout: 10_000 })
    await expect(page.locator('main')).toContainText('Success Count')
    await expect(page.locator('main')).toContainText('Success Rate')
  })

  test('tab switching hides previous content', async ({ page }) => {
    await page.goto('/metrics')
    // Start on Cost tab
    await expect(page.locator('main h3:has-text("Cost Trend")')).toBeVisible()
    // Switch to Operations
    await page.locator('main button:has-text("Operations")').click()
    await expect(page.locator('main h3:has-text("Cost Trend")')).not.toBeVisible()
    await expect(page.locator('main h3:has-text("Task Completion Rate")')).toBeVisible()
  })

  test('time range buttons are clickable', async ({ page }) => {
    await page.goto('/metrics')
    const btn7d = page.locator('main button:has-text("7d")')
    await btn7d.click()
    // Active button should have accent glow style
    await expect(btn7d).toHaveClass(/bg-\[var\(--color-accent-glow\)\]/)
  })

  test('Custom time range shows date inputs', async ({ page }) => {
    await page.goto('/metrics')
    await page.locator('main button:has-text("Custom")').click()
    // Custom range inputs should appear
    await expect(page.locator('main input[type="date"]').first()).toBeVisible()
    await expect(page.locator('main input[type="date"]').last()).toBeVisible()
    await expect(page.locator('main')).toContainText('From')
    await expect(page.locator('main')).toContainText('To')
  })
})
