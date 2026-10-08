import { test as it, expect } from '@playwright/test'
import { chromium, type Browser, type Page } from '@playwright/test'
import { HTMLRenderer, defaultTheme, renderLookup, renderWidget, type Blueprint } from '@zebric/runtime-core'

const { describe, beforeEach, afterEach } = it

// Both runtime adapters render this identical browser client.
describe('Live page browser behavior @live', () => {
  let browser: Browser
  let page: Page
  let version: number
  let projections: number
  let saves: number
  let searches: number
  let delayProjection: (() => Promise<void>) | undefined
  let delayRename: (() => Promise<void>) | undefined
  let renames: number
  let failSave: boolean
  let projectionStatus: number
  let delaySave: (() => Promise<void>) | undefined
  const errors: string[] = []
  const blueprint: Blueprint = {
    version: '1.0', project: { name: 'Live test', version: '1.0', runtime: { min_version: '0.1' } }, entities: [], pages: [],
  }
  const render = (cursor: number) => {
    const board = renderWidget({ blueprint, theme: defaultTheme, page: { path: '/view', title: 'Board' }, data: {},
      widget: { kind: 'board', entity: 'Task', column_entity: 'Status', columns: [{ value: 'todo', label: 'Todo' }], on_column_rename: { update: {} } } })
    const lookup = renderLookup({ mount: 'form-field', fieldName: 'owner', inputId: 'owner', pagePath: '/view', field: 'owner', config: { entity: 'User', search: ['name'] } }).html
    const view = { form: { entity: 'Task', method: 'create' as const, fields: [{ name: 'owner', type: 'lookup' as const, lookup: { entity: 'User', search: ['name'] } }] }, path: '/view', title: 'Live test', live: true, auth: 'none' as const, template: { type: 'inline' as const, source:
      `<p id="version">Version ${cursor}</p>${board}<form action="/save" method="POST" data-enhance="inline"><input id="title" name="title" value="original"><textarea id="body" name="body">original</textarea>${lookup}<button type="submit">Save</button><button type="reset">Reset</button></form><div style="height:2000px"></div>` } }
    return new HTMLRenderer({ ...blueprint, pages: [view] }, defaultTheme).renderPage({ page: view, data: {}, params: {}, query: {}, liveCursor: String(cursor) })
  }
  beforeEach(async () => {
    version = projections = saves = searches = renames = 0
    delayRename = undefined
    failSave = false; delayProjection = undefined; delaySave = undefined; projectionStatus = 200; errors.length = 0
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' })
    page = await browser.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      class TestSource extends EventTarget {
        onopen?: () => void
        onerror?: () => void
        constructor(public url: string) { super(); (window as any).liveSource = this; setTimeout(() => this.onopen?.(), 0) }
        close() {}
      }
      ;(window as any).EventSource = TestSource
    })
    await page.route('https://live.test/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/view') {
        projections++
        const captured = version
        await delayProjection?.()
        await route.fulfill({ status: projectionStatus, contentType: 'text/html', body: render(captured) })
      } else if (url.pathname === '/_widget/search') {
        searches++
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ id: 'operator', label: 'Operator' }] }) })
      } else if (url.pathname === '/_widget/event') {
        renames++
        await delayRename?.()
        await route.fulfill({ status: failSave ? 400 : 200, contentType: 'application/json', body: '{}' })
      } else if (url.pathname === '/save') {
        saves++
        await delaySave?.()
        await route.fulfill({ status: failSave ? 400 : 200, contentType: 'application/json', body: '{}' })
      } else {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: Number(url.searchParams.get('cursor')) === version ? 'current' : 'invalidate', cursor: String(version) }) })
      }
    })
    await page.goto('https://live.test/view')
    await expect.poll(() => page.locator('[data-zebric-live-status]').textContent()).toBe('Live')
  })
  afterEach(async () => {
    await browser?.close()
    expect(errors).toEqual([])
  })
  const invalidate = async (cursor = version) => page.evaluate(value => {
    ;(window as any).liveSource.dispatchEvent(new MessageEvent('invalidate', { data: JSON.stringify({ type: 'invalidate', cursor: String(value) }) }))
  }, cursor)

  it('defers replacement during column edits and resumes after cancellation', async () => {
    const heading = page.locator('[data-editable="true"]')
    await heading.dblclick()
    await heading.fill('Unsaved column')
    version = 1; await invalidate()
    await page.waitForTimeout(350)
    expect(projections).toBe(1)
    await expect(heading).toHaveText('Unsaved column')
    await heading.press('Escape')
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 1')
    expect(renames).toBe(0)
  })

  for (const failed of [false, true]) it(`protects column edits through a ${failed ? 'failed' : 'successful'} save`, async () => {
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    delayRename = () => waiting
    failSave = failed
    const heading = page.locator('[data-editable="true"]')
    await heading.dblclick()
    await heading.fill('Saved column')
    await heading.press('Enter')
    await expect.poll(() => renames).toBe(1)
    version = 1; await invalidate()
    await page.waitForTimeout(350)
    expect(projections).toBe(1)
    await expect(heading).toHaveText('Saved column')
    release()
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 1')
  })

  it('protects column edits started during an in-flight refresh', async () => {
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    delayProjection = () => waiting
    version = 1; await invalidate()
    await expect.poll(() => projections).toBe(2)
    const heading = page.locator('[data-editable="true"]')
    await heading.dblclick()
    await heading.fill('Typed during fetch')
    release()
    await page.waitForTimeout(200)
    await expect(heading).toHaveText('Typed during fetch')
    await expect(page.locator('#version')).toHaveText('Version 0')
    delayProjection = undefined
    await heading.press('Escape')
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 1')
  })

  it('debounces notifications, ignores duplicates, and preserves scroll, focus, and selection', async () => {
    await page.locator('#title').focus()
    await page.locator('#title').evaluate((input: HTMLInputElement) => input.setSelectionRange(1, 4))
    await page.evaluate(() => window.scrollTo(0, 650))
    version = 3
    await invalidate(1); await invalidate(2); await invalidate(3)
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 3')
    expect(projections).toBe(2)
    expect(await page.evaluate(() => [scrollY, document.activeElement?.id, (document.activeElement as HTMLInputElement).selectionStart])).toEqual([650, 'title', 1])
    await invalidate(3)
    await page.waitForTimeout(300)
    expect(projections).toBe(2)
  })

  it('protects edits after blur and refreshes pending changes after reset', async () => {
    await page.locator('#title').fill('unsaved')
    await page.locator('#title').blur()
    version = 1; await invalidate()
    await page.waitForTimeout(350)
    expect(projections).toBe(1)
    expect(await page.locator('#title').inputValue()).toBe('unsaved')
    await page.locator('button[type=reset]').click()
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 1')
  })

  it('re-enhances replaced forms once and clears dirty state after a successful save', async () => {
    version = 1; await invalidate()
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 1')
    await page.locator('#title').fill('saved')
    version = 2; await invalidate()
    await page.locator('button[type=submit]').click()
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 2')
    expect(saves).toBe(1)
  })

  it('re-initializes lookup controls once after replacing main content', async () => {
    version = 1; await invalidate()
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 1')
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('zebric:enhance')))
    await page.locator('#owner').fill('Oper')
    await expect(page.locator('.control-lookup-item')).toHaveText('Operator')
    expect(searches).toBe(1)
  })

  it('retains dirty input when a form reset is canceled', async () => {
    await page.locator('form').evaluate(form => form.addEventListener('reset', event => event.preventDefault()))
    await page.locator('#title').fill('unsaved')
    version = 1; await invalidate()
    await page.locator('button[type=reset]').click()
    await page.waitForTimeout(350)
    expect(projections).toBe(1)
    expect(await page.locator('#title').inputValue()).toBe('unsaved')
  })

  it('keeps failed saves dirty', async () => {
    page.on('dialog', dialog => dialog.dismiss())
    failSave = true
    await page.locator('#body').fill('unsaved body')
    version = 1; await invalidate()
    await page.locator('button[type=submit]').click()
    await expect.poll(() => saves).toBe(1)
    await page.waitForTimeout(350)
    expect(projections).toBe(1)
    expect(await page.locator('#body').inputValue()).toBe('unsaved body')
  })

  it('protects input changed during an in-flight refresh', async () => {
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    delayProjection = () => waiting
    version = 1; await invalidate()
    await expect.poll(() => projections).toBe(2)
    await page.locator('#title').fill('typed during fetch')
    release()
    await page.waitForTimeout(200)
    expect(await page.locator('#title').inputValue()).toBe('typed during fetch')
    expect(await page.locator('#version').textContent()).toBe('Version 0')
    delayProjection = undefined
    await page.locator('button[type=reset]').click()
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 1')
  })

  it('serializes refreshes and catches invalidations during a slow response', async () => {
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    delayProjection = () => waiting
    version = 1; await invalidate()
    await expect.poll(() => projections).toBe(2)
    version = 2; await invalidate()
    delayProjection = undefined; release()
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 2')
    expect(projections).toBe(3)
  })

  it('falls back to polling and catches up after an SSE failure', async () => {
    version = 1
    await page.evaluate(() => (window as any).liveSource.onerror())
    await expect.poll(() => page.locator('#version').textContent()).toBe('Version 1')
    expect(await page.locator('[data-zebric-live-status]').textContent()).toBe('Live')
  })

  it('retries a temporary projection failure without discarding the current view', async () => {
    projectionStatus = 503
    version = 1; await invalidate()
    await expect(page.locator('[data-zebric-live-status]')).toHaveText('Reconnecting')
    await expect(page.locator('#version')).toHaveText('Version 0')
    projectionStatus = 200
    await expect(page.locator('#version')).toHaveText('Version 1')
    expect(projections).toBe(3)
  })

  for (const status of [401, 403]) it(`stops refreshing after projection authorization returns ${status}`, async () => {
    projectionStatus = status
    version = 1; await invalidate()
    await expect(page.locator('[data-zebric-live-status]')).toHaveText('Reconnecting')
    await expect(page.locator('#version')).toHaveText('Version 0')
    version = 2; await invalidate()
    // Exceed both the refresh debounce and retry interval to verify shutdown.
    await page.waitForTimeout(1200)
    expect(projections).toBe(2)
  })

  it('does not clear edits made after submitting a form while its save is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    delaySave = () => gate
    try {
      await page.locator('#title').fill('Submitted value')
      await page.locator('button[type=submit]').click()
      await expect.poll(() => saves).toBe(1)
      await page.locator('#title').fill('New unsaved value')
      version = 1; await invalidate()
      const saved = page.waitForResponse('https://live.test/save')
      release()
      await saved
      await page.waitForTimeout(350)
      expect(projections).toBe(1)
      await expect(page.locator('#title')).toHaveValue('New unsaved value')
      await page.locator('button[type=reset]').click()
      await expect(page.locator('#version')).toHaveText('Version 1')
    } finally { release() }
  })
})
