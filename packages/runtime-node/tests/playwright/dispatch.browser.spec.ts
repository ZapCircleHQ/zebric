import { test, expect } from './fixtures/zebric-fixtures.js'
import { expectNoAccessibilityViolations } from './helpers/accessibility.js'
import {
  expectCorePageChrome,
  expectFormField,
  expectPrimaryNavigation,
  expectRenderablePage,
  measureGoto,
} from './helpers/page-contracts.js'

test.describe('Zebric browser harness - Dispatch', () => {
  test('@accessibility Dispatch pages pass axe and structural accessibility checks', async ({ page, app }) => {
    for (const path of ['/', '/issues', '/issues/new']) {
      await page.goto(`${app.baseURL}${path}`)
      await expectRenderablePage(page)
      await expectCorePageChrome(page)
      await expectPrimaryNavigation(page)
      await expectNoAccessibilityViolations(page)
    }
  })

  test('@rendering list and form pages render Zazzle UX attributes', async ({ page, app }) => {
    await page.goto(`${app.baseURL}/issues`)
    await expectRenderablePage(page)
    await expect(page.locator('[data-zebric-navigation-model="sidebar"]')).toBeVisible()
    await expect(page.locator('[data-zebric-density="compact"]')).toBeVisible()
    await expect(page.locator('table caption')).toContainText('Issue list')

    await page.goto(`${app.baseURL}/issues/new`)
    await expectRenderablePage(page)
    await expect(page.locator('form[aria-labelledby="form-title"][data-zebric-primitive="form"]')).toBeVisible()
    await expect(page.locator('[data-zebric-primitive="section"]')).toHaveCount(2)
    await expectFormField(page.locator('form'), 'title')
    await expectFormField(page.locator('form'), 'description')
    await expectFormField(page.locator('form'), 'category')
    await expectFormField(page.locator('form'), 'priority')
  })

  test('@journey creates an issue through the rendered form', async ({ page, app }) => {
    await page.goto(`${app.baseURL}/issues/new`)

    await page.getByLabel('Title').fill('Playwright Created Issue')
    await page.getByLabel('Description').fill('Created by the browser journey harness.')
    await page.getByLabel('Category').selectOption('platform')
    await page.getByLabel('Priority').selectOption('high')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByText('Playwright Created Issue')).toBeVisible()
    await expectRenderablePage(page)
    await expectCorePageChrome(page)
  })

  test('@performance core pages render within the smoke threshold', async ({ page, app }) => {
    const timings: Record<string, number> = {}

    for (const path of ['/', '/issues', '/issues/new']) {
      timings[path] = await measureGoto(page, `${app.baseURL}${path}`)
      await expectRenderablePage(page)
    }

    expect(timings['/']).toBeLessThan(2_000)
    expect(timings['/issues']).toBeLessThan(2_000)
    expect(timings['/issues/new']).toBeLessThan(2_000)
  })
})
