import type { Locator, Page } from '@playwright/test'
import { expect } from '../fixtures/zebric-fixtures.js'

export async function expectCorePageChrome(page: Page): Promise<void> {
  await expect(page.locator('a[href="#main-content"]')).toContainText('Skip to main content')
  await expect(page.locator('main#main-content[role="main"][aria-label="Main content"]')).toBeVisible()
}

export async function expectPrimaryNavigation(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
}

export async function expectRenderablePage(page: Page): Promise<void> {
  await expect(page.locator('body')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Internal Server Error')
  await expect(page.locator('body')).not.toContainText('Record not found')
  await expect(page.locator('pre')).toHaveCount(0)
}

export async function expectFormField(locator: Locator, name: string): Promise<void> {
  await expect(locator.locator(`[name="${name}"]`)).toBeVisible()
}

export async function measureGoto(page: Page, url: string): Promise<number> {
  const started = Date.now()
  await page.goto(url)
  await page.waitForLoadState('domcontentloaded')
  return Date.now() - started
}
