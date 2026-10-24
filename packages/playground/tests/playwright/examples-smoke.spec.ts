import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

async function collectPageErrors(page: Page, run: () => Promise<void>) {
  const errors: string[] = []
  const onPageError = (err: Error) => errors.push(`pageerror: ${err.message}`)
  const onConsole = (msg: ConsoleMessage) => {
    // Ignore browser-level resource 404s (e.g. the implicit /favicon.ico probe) -
    // we only care about JS runtime errors from the app itself here.
    if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) {
      errors.push(`console.error: ${msg.text()}`)
    }
  }
  page.on('pageerror', onPageError)
  page.on('console', onConsole)
  try {
    await run()
  } finally {
    page.off('pageerror', onPageError)
    page.off('console', onConsole)
  }
  return errors
}

test('home page loads without runtime errors', async ({ page }) => {
  const errors = await collectPageErrors(page, async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Zebric Playground' })).toBeVisible()
  })
  expect(errors, 'Unexpected errors while rendering /').toEqual([])
})

test('Friendly Paws sidebar stays anchored inside the preview when the playground scrolls', async ({ page }) => {
  await page.goto('/examples/friendly-paws')
  const preview = page.locator('.zebric-simulator__preview')
  const sidebar = preview.locator('.zb-sidebar')
  await expect(sidebar).toBeVisible()

  for (const scrollY of [0, 300]) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY)
    const previewBounds = await preview.boundingBox()
    const sidebarBounds = await sidebar.boundingBox()
    expect(previewBounds).not.toBeNull()
    expect(sidebarBounds).not.toBeNull()
    expect(sidebarBounds!.x).toBeCloseTo(previewBounds!.x, 0)
    expect(sidebarBounds!.y).toBeCloseTo(previewBounds!.y, 0)
    expect(sidebarBounds!.x + sidebarBounds!.width).toBeLessThanOrEqual(previewBounds!.x + previewBounds!.width)
  }
})

test('every playground example renders its simulator without runtime errors', async ({ page }) => {
  await page.goto('/examples')
  const hrefs = await page
    .locator('a[href^="/examples/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  const slugs = [...new Set(hrefs.filter((href): href is string => Boolean(href)))]

  expect(slugs.length, 'Expected at least one example link on /examples').toBeGreaterThan(0)

  for (const href of slugs) {
    const errors = await collectPageErrors(page, async () => {
      await page.goto(href)
      await expect(page.locator('.zebric-simulator__tabs[role="tablist"]')).toBeVisible()
    })
    expect(errors, `Unexpected errors while rendering ${href}`).toEqual([])
  }
})
