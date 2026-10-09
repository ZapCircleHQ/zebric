import { test, expect } from '@playwright/test'
import { HTMLRenderer } from '../../../runtime-core/src/renderer/html-renderer.js'
import { DESIGN_SYSTEM_NAMES } from '../../../runtime-core/src/renderer/design-system.js'
import type { Blueprint, Page } from '../../../runtime-core/src/types/blueprint.js'

const detailPage: Page = {
  path: '/requests/:id', title: 'Request', layout: 'detail',
  queries: { request: { entity: 'Request' }, events: { entity: 'AuditEvent' } },
  actionBar: { showStatus: true, actions: [{ label: 'Delete', style: 'danger', href: '/delete' }] },
}

function render(designSystem: Blueprint['design_system']): string {
  const blueprint: Blueprint = {
    version: '1.0', project: { name: 'Zazzle test', version: '1.0', runtime: { min_version: '0.1' } },
    design_system: designSystem,
    entities: [
      { name: 'Request', fields: [
        { name: 'id', type: 'ULID', primary_key: true },
        { name: 'title', type: 'Text' },
        { name: 'description', type: 'LongText' },
        { name: 'status', type: 'Enum', values: ['rejected'] },
      ] },
      { name: 'AuditEvent', fields: [{ name: 'title', type: 'Text' }] },
    ],
    pages: [detailPage],
  }
  return new HTMLRenderer(blueprint).renderPage({
    page: detailPage, params: { id: 'request-1' }, query: {},
    data: {
      request: { id: 'request-1', title: 'Laptop', description: 'First line\nSecond line', status: 'rejected' },
      events: [{ title: 'Request reviewed', detail: 'Review complete' }],
    },
    flash: { type: 'error', text: 'Request rejected.' },
  })
}

for (const name of DESIGN_SYSTEM_NAMES) {
  for (const mode of ['light', 'dark'] as const) {
    test(`@rendering Zazzle ${name} ${mode} keeps details and feedback legible`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: mode })
      await page.setContent(render({ name }))

      const values = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement)
        const tokenColor = (token: string) => {
          const probe = document.createElement('span')
          probe.style.color = root.getPropertyValue(`--zb-${token}`)
          document.body.append(probe)
          const color = getComputedStyle(probe).color
          probe.remove()
          return color
        }
        const color = (selector: string) => getComputedStyle(document.querySelector(selector)!).color
        const badge = getComputedStyle(document.querySelector('.zb-status-negative')!)
        const feedback = getComputedStyle(document.querySelector('.zb-feedback-error')!)
        return {
          detail: color('dd'), activity: color('ul[role="list"] p'),
          primary: tokenColor('text-primary'), error: tokenColor('color-error'), card: tokenColor('surface-card'),
          badge: { color: badge.color, background: badge.backgroundColor },
          feedback: { color: feedback.color, background: feedback.backgroundColor },
          danger: color('.zb-button-danger'),
          stateColors: ['color-success', 'color-warning', 'color-error', 'color-info'].map(tokenColor),
        }
      })
      expect(values.detail).toBe(values.primary)
      expect(values.activity).toBe(values.primary)
      expect(values.badge).toEqual({ color: values.error, background: values.card })
      expect(values.feedback).toEqual({ color: values.error, background: values.card })
      expect(values.danger).toBe(values.error)

      // Check the actual cascade against the AA threshold for small text.
      const luminance = (color: string) => {
        const rgb = color.match(/\d+/g)!.slice(0, 3).map(value => {
          const channel = Number(value) / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!
      }
      const background = luminance(values.badge.background)
      for (const color of values.stateColors) {
        const foreground = luminance(color)
        expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)).toBeGreaterThanOrEqual(4.5)
      }
      await expect(page.locator('dd').filter({ hasText: 'First line' })).toHaveCSS('white-space', 'pre-wrap')
    })
  }
}

test('@rendering custom error tokens reach both status badges and feedback', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setContent(render({ name: 'acme', extends: 'modern', tokens: { 'color-error': '#92306a' } }))
  await expect(page.locator('.zb-status-negative')).toHaveCSS('color', 'rgb(146, 48, 106)')
  await expect(page.locator('.zb-feedback-error')).toHaveCSS('color', 'rgb(146, 48, 106)')
})

test('@rendering custom stylesheets override inherited dark state colors', async ({ page }) => {
  await page.route('https://zazzle.test/custom.css', route => route.fulfill({
    contentType: 'text/css',
    body: 'html[data-zebric-design-system="acme"][data-zebric-resolved-color-mode="dark"]{--zb-color-error:#ff91b0}',
  }))
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setContent(render({ name: 'acme', extends: 'modern', css: ['https://zazzle.test/custom.css'] }))
  await expect(page.locator('.zb-status-negative')).toHaveCSS('color', 'rgb(255, 145, 176)')
  await expect(page.locator('.zb-feedback-error')).toHaveCSS('color', 'rgb(255, 145, 176)')
})
