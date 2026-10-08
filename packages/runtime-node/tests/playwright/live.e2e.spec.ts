import { test, expect } from '@playwright/test'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { Hono } from 'hono'
import { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { CommandExecutor, defaultTheme, type Blueprint, type UserSession } from '@zebric/runtime-core'
import { blueprint as contractBlueprint, session } from '../../../../tests/runtime-conformance/fixtures.js'
import { mutateThroughMcp } from '../../../mcp-server/tests/live-mutation-helper.js'
import { DatabaseConnection } from '../../src/database/connection.js'
import { QueryExecutor } from '../../src/database/query-executor.js'
import { WorkflowManager } from '../../src/workflows/workflow-manager.js'
import { applyCsrfProtection, createApiKeyRegistry } from '../../src/engine/server-security.js'
import { registerAPIRoutes, registerCommandRoutes, registerOpenAPIRoute, registerPageRoutes } from '../../src/engine/server-routes.js'

// Real TCP, browser EventSource/fetch, HTTP routes, commands, MCP, workflows and
// SQLite. Only session lookup is controlled by the fixture; login is out of scope.
test.describe('Live Mode over a real Node HTTP server @journey @live', () => {
  let server: ServerType
  let connection: DatabaseConnection
  let queries: QueryExecutor
  let workflows: WorkflowManager
  let baseURL: string
  let currentSession: UserSession | null
  const csrf = 'live-e2e'

  const blueprint: Blueprint = { ...contractBlueprint, pages: contractBlueprint.pages.map(page => page.path !== '/live-items' ? page : {
    ...page, template: { type: 'inline', engine: 'liquid', source: `
      <ul id="items">{% for item in data.items %}<li data-item="{{ item.id }}">{{ item.title }}: {{ item.status }}</li>{% endfor %}</ul>
      <form><label for="draft">Local draft</label><input id="draft" name="draft" value="original"><button type="reset">Reset</button></form>
    ` },
  }) }

  const fetchRuntime = (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('cookie', `csrf-token=${csrf}`)
    headers.set('x-csrf-token', csrf)
    return fetch(baseURL + path, { ...init, headers })
  }

  test.beforeEach(async ({ context }) => {
    currentSession = session
    connection = new DatabaseConnection({ type: 'sqlite', filename: ':memory:' }, blueprint)
    await connection.connect()
    queries = new QueryExecutor(connection)
    await queries.create('Item', { id: 'source', title: 'Initial' }, { session })
    const app = new Hono()
    const apiKeys = createApiKeyRegistry([{ token: 'writer-key', credential: {
      name: 'writer', agentId: 'writer', credentialId: 'writer', displayName: 'writer', roles: ['operator'], scopes: ['*'],
    } }])
    app.use('*', async (c, next) => {
      const rejection = await applyCsrfProtection(c, 'csrf-token', apiKeys)
      if (rejection) return rejection
      await next()
    })
    const deps = { blueprint, queryExecutor: queries, sessionManager: { getSession: async () => currentSession }, apiKeys }
    const commands = new CommandExecutor(blueprint, { queryExecutor: queries })
    workflows = new WorkflowManager({ dataLayer: queries, commandExecutor: commands })
    workflows.setCommandExecutor(commands)
    for (const workflow of blueprint.workflows ?? []) workflows.registerWorkflow(workflow as Parameters<typeof workflows.registerWorkflow>[0])
    registerOpenAPIRoute(app, blueprint, { port: 0 } as Parameters<typeof registerOpenAPIRoute>[2])
    registerAPIRoutes(app, deps as Parameters<typeof registerAPIRoutes>[1])
    registerCommandRoutes(app, { ...deps, commandExecutor: commands } as Parameters<typeof registerCommandRoutes>[1])
    registerPageRoutes(app, new BlueprintHttpAdapter({ ...deps, theme: defaultTheme }))
    server = await new Promise<ServerType>(resolve => {
      const running = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve(running))
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No HTTP listener')
    baseURL = `http://127.0.0.1:${address.port}`
    await context.addCookies([{ name: 'csrf-token', value: csrf, url: baseURL }])
  })

  test.afterEach(async ({ context }) => {
    // Close EventSource connections before shutting down the server and storage.
    await Promise.all(context.pages().map(page => page.close()))
    if (server) await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
    await workflows?.shutdown()
    await connection?.close()
  })

  const runWorkflow = async (name: string) => {
    const job = workflows.trigger(name, { session })
    await workflows.ensurePersisted(job.id)
    await expect.poll(async () => (await workflows.getDurableJob(job.id))?.status).toMatch(/completed|failed/)
    return (await workflows.getDurableJob(job.id))!.status
  }

  for (const source of ['UI', 'HTTP', 'MCP', 'command', 'workflow']) {
    test(`${source} mutation reaches an already-open browser without navigation`, async ({ page, context }) => {
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      let navigations = 0
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
      await page.goto(baseURL + '/live-items')
      await expect(page.locator('[data-item="source"]')).toHaveText('Initial: draft')
      await expect(page.locator('[data-zebric-live-status]')).toHaveText('Live')
      if (source === 'UI') {
        const editor = await context.newPage()
        await editor.goto(baseURL + '/new-item')
        await editor.locator('[name="title"]').fill('UI change')
        await editor.locator('button[type="submit"]').click()
        await expect(page.locator('#items')).toContainText('UI change')
      } else if (source === 'HTTP') {
        expect((await fetchRuntime('/api/items/source', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"title":"HTTP change"}' })).status).toBe(200)
        await expect(page.locator('[data-item="source"]')).toHaveText('HTTP change: draft')
      } else if (source === 'MCP') {
        await mutateThroughMcp(fetchRuntime, baseURL)
        await expect(page.locator('[data-item="source"]')).toHaveText('Initial: published')
      } else if (source === 'command') {
        expect((await fetchRuntime('/api/commands/publish_item/source', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(200)
        await expect(page.locator('[data-item="source"]')).toHaveText('Initial: published')
      } else {
        expect(await runWorkflow('CopyItems')).toBe('completed')
        await expect(page.locator('[data-item="copy-source"]')).toHaveText('Initial: draft')
      }
      expect(navigations).toBe(1)
      expect(errors).toEqual([])
    })
  }

  test('HTTP create, update, and delete propagate to two independent viewers', async ({ page, context }) => {
    const second = await context.newPage()
    await Promise.all([page.goto(baseURL + '/live-items'), second.goto(baseURL + '/live-items')])
    const headers = { 'content-type': 'application/json' }
    expect((await fetchRuntime('/api/items', { method: 'POST', headers, body: '{"id":"crud","title":"Created"}' })).status).toBe(201)
    for (const viewer of [page, second]) await expect(viewer.locator('[data-item="crud"]')).toHaveText('Created: draft')
    expect((await fetchRuntime('/api/items/crud', { method: 'PUT', headers, body: '{"title":"Updated"}' })).status).toBe(200)
    for (const viewer of [page, second]) await expect(viewer.locator('[data-item="crud"]')).toHaveText('Updated: draft')
    expect((await fetchRuntime('/api/items/crud', { method: 'DELETE' })).status).toBe(200)
    for (const viewer of [page, second]) await expect(viewer.locator('[data-item="crud"]')).toHaveCount(0)
  })

  test('catches a committed mutation between SSR and opening the SSE subscription', async ({ page }) => {
    // Hold the actual subscription; no EventSource or server response is mocked.
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let requested = false
    await page.route('**/_zebric/live?**', async route => { requested = true; await gate; await route.continue() })
    try {
      await page.goto(baseURL + '/live-items')
      await expect.poll(() => requested).toBe(true)
      await expect(page.locator('[data-item="source"]')).toHaveText('Initial: draft')
      await queries.update('Item', 'source', { title: 'Raced' }, { session })
      release()
      await expect(page.locator('[data-item="source"]')).toHaveText('Raced: draft')
    } finally { release() }
  })

  test('falls back to real polling when SSE is unavailable and preserves a dirty form', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(window, 'EventSource', { value: undefined }) })
    await page.goto(baseURL + '/live-items')
    await expect(page.locator('[data-zebric-live-status]')).toHaveText('Live')
    await page.locator('#draft').fill('Unsaved draft')
    const poll = page.waitForResponse(response => response.url().includes('transport=poll'))
    await queries.update('Item', 'source', { title: 'From polling' }, { session })
    expect(await (await poll).json()).toMatchObject({ type: 'invalidate' })
    await expect(page.locator('#draft')).toHaveValue('Unsaved draft')
    await expect(page.locator('[data-item="source"]')).toHaveText('Initial: draft')
    await page.locator('button[type="reset"]').click()
    await expect(page.locator('[data-item="source"]')).toHaveText('From polling: draft')
  })

  test('stops an authenticated SSE viewer after session revocation', async ({ page }) => {
    await page.goto(baseURL + '/live-items')
    await expect(page.locator('[data-zebric-live-status]')).toHaveText('Live')
    currentSession = null
    await queries.update('Item', 'source', { title: 'Must not appear' }, { session })
    await expect(page.locator('[data-zebric-live-status]')).toHaveText('Reconnecting')
    await expect(page.locator('[data-item="source"]')).toHaveText('Initial: draft')
  })

  test('recovers a dropped real SSE connection through polling without losing edits', async ({ page }) => {
    await page.goto(baseURL + '/live-items')
    await expect(page.locator('[data-zebric-live-status]')).toHaveText('Live')
    await page.locator('#draft').fill('Keep after disconnect')
    const fallback = page.waitForResponse(response => response.url().includes('transport=poll'))
    // Drop existing HTTP sockets; the listener stays up for new poll/SSR requests.
    server.closeAllConnections()
    await queries.update('Item', 'source', { title: 'After disconnect' }, { session })
    expect((await fallback).status()).toBe(200)
    const reconciliation = await fetchRuntime('/_zebric/live?' + new URLSearchParams({
      path: '/live-items', cursor: (await page.locator('#main-content').getAttribute('data-zebric-live-cursor'))!, transport: 'poll',
    }))
    expect(await reconciliation.json()).toMatchObject({ type: 'invalidate' })
    await expect(page.locator('#draft')).toHaveValue('Keep after disconnect')
    await expect(page.locator('[data-item="source"]')).toHaveText('Initial: draft')
    await page.locator('button[type="reset"]').click()
    await expect(page.locator('[data-item="source"]')).toHaveText('After disconnect: draft')
  })

  test('a rolled-back workflow leaves the viewer current and a later commit still refreshes it', async ({ page }) => {
    await page.goto(baseURL + '/live-items')
    await expect(page.locator('[data-zebric-live-status]')).toHaveText('Live')
    const cursor = await page.locator('#main-content').getAttribute('data-zebric-live-cursor')
    expect(await runWorkflow('RollbackWorkflow')).toBe('failed')
    const response = await fetchRuntime('/_zebric/live?' + new URLSearchParams({ path: '/live-items', cursor: cursor!, transport: 'poll' }))
    expect(await response.json()).toEqual({ type: 'current', cursor })
    await expect(page.locator('[data-item="workflow-rollback"]')).toHaveCount(0)
    expect(await runWorkflow('UpdateItem')).toBe('completed')
    await expect(page.locator('[data-item="source"]')).toHaveText('workflow update: draft')
  })
})
