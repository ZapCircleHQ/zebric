import { test, expect, signInAsAdmin, SEEDED_CATEGORY_NAME } from './fixtures/zebric-fixtures.js'
import { expectNoAccessibilityViolations } from './helpers/accessibility.js'
import {
  expectCorePageChrome,
  expectFormField,
  expectPrimaryNavigation,
  expectRenderablePage,
  measureGoto,
} from './helpers/page-contracts.js'

test.describe('Zebric browser harness - Dispatch', () => {
  test.beforeEach(async ({ page, app }) => {
    await signInAsAdmin(page, app.baseURL)
  })

  test('@accessibility Dispatch pages pass axe and structural accessibility checks', async ({ page, app }) => {
    for (const path of ['/', '/requests', '/requests/new']) {
      await page.goto(`${app.baseURL}${path}`)
      await expectRenderablePage(page)
      await expectCorePageChrome(page)
      await expectPrimaryNavigation(page)
      await expectNoAccessibilityViolations(page)
    }
  })

  test('@rendering list and form pages render Zazzle UX attributes', async ({ page, app }) => {
    await page.goto(`${app.baseURL}/requests`)
    await expectRenderablePage(page)
    await expect(page.locator('[data-zebric-navigation-model="sidebar"]')).toBeVisible()
    await expect(page.locator('a.rq-new', { hasText: 'New request' })).toBeVisible()
    await expect(page.locator('table')).toBeVisible()
    const headerText = (await page.locator('table thead').innerText()).toLowerCase()
    for (const label of ['request', 'category', 'priority', 'status']) {
      expect(headerText).toContain(label)
    }

    await page.goto(`${app.baseURL}/requests/new`)
    await expectRenderablePage(page)
    await expect(page.locator('form[aria-labelledby="form-title"][data-zebric-primitive="form"]')).toBeVisible()
    await expect(page.locator('[data-zebric-primitive="section"]')).toHaveCount(2)
    await expectFormField(page.locator('form'), 'categoryId')
    await expectFormField(page.locator('form'), 'title')
    await expectFormField(page.locator('form'), 'description')
    await expectFormField(page.locator('form'), 'priority')
  })

  test('@journey creates a request through the rendered form', async ({ page, app }) => {
    await page.goto(`${app.baseURL}/requests/new`)

    await page.locator('[name="categoryId"]').selectOption({ label: SEEDED_CATEGORY_NAME })
    await page.locator('[name="title"]').fill('Playwright Created Request')
    await page.locator('[name="description"]').fill('Created by the browser journey harness.')
    await page.locator('[name="priority"]').selectOption('high')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page).toHaveURL(/\/requests\/(?!new)[^/]+$/)
    await expect(page.getByText('Playwright Created Request')).toBeVisible()
    await expectRenderablePage(page)
    await expectCorePageChrome(page)
  })

  test('@performance core pages render within the smoke threshold', async ({ page, app }) => {
    const timings: Record<string, number> = {}

    for (const path of ['/', '/requests', '/requests/new']) {
      timings[path] = await measureGoto(page, `${app.baseURL}${path}`)
      await expectRenderablePage(page)
    }

    expect(timings['/']).toBeLessThan(2_000)
    expect(timings['/requests']).toBeLessThan(2_000)
    expect(timings['/requests/new']).toBeLessThan(2_000)
  })
})
