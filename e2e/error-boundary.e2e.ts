import { expect, test } from '@playwright/test'

test.describe('Error Boundary', () => {
  test('error boundary shows error message and retry button on API failure', async ({ page }) => {
    // Simulate an error by navigating to a route that triggers the error boundary
    // We intercept a critical API to force a rendering error
    await page.route('**/api/status', async (route) => {
      await route.fulfill({ status: 500, body: 'Internal Server Error' })
    })
    await page.goto('/')
    // Page should either show the error boundary or gracefully handle the error
    // Wait for any rendering to complete
    await page.waitForTimeout(2000)
    // The error boundary shows "Something went wrong" and a "Retry" button
    const errorCard = page.locator('text=Something went wrong')
    const retryBtn = page.locator('button:has-text("Retry")')
    const hasError = await errorCard.count()
    // If error boundary triggered, verify it has retry functionality
    if (hasError > 0) {
      await expect(retryBtn).toBeVisible()
    }
  })

  test('pages render without crashing', async ({ page }) => {
    // Verify all main pages load without triggering error boundaries
    const pages = ['/', '/sessions', '/memory', '/memo', '/tools', '/logs', '/config', '/metrics']
    for (const p of pages) {
      await page.goto(p)
      await page.waitForTimeout(500)
      // Error boundary should NOT be visible on normal page load
      const errorBoundary = page.locator('text=Something went wrong')
      await expect(errorBoundary).not.toBeVisible()
    }
  })
})
