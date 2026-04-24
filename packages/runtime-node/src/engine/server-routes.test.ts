import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { injectCsrfTokenIntoRequest } from '@zebric/runtime-core'
import type { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { registerAPIRoutes, registerActionRoutes, registerPageRoutes, registerSearchRoutes } from './server-routes.js'

describe('registerPageRoutes', () => {
  it('sets a CSRF cookie when a safe page request generated a token', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      injectCsrfTokenIntoRequest(c.req.raw, 'csrf-from-safe-request')
      await next()
    })
    registerPageRoutes(app, htmlAdapter())

    const response = await app.request('/issues/new')

    expect(response.headers.get('set-cookie')).toContain('csrf-token=csrf-from-safe-request')
  })

  it('does not overwrite an existing CSRF cookie', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      injectCsrfTokenIntoRequest(c.req.raw, 'replacement-token')
      await next()
    })
    registerPageRoutes(app, htmlAdapter())

    const response = await app.request('/issues/new', {
      headers: { cookie: 'csrf-token=existing-token' },
    })

    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('registerAPIRoutes access context', () => {
  const blueprint = {
    version: '0.1.0',
    project: { name: 'API test', version: '0.1.0', runtime: { min_version: '0.1.0' } },
    entities: [{ name: 'Item', fields: [{ name: 'id', type: 'ULID', primary_key: true }] }],
    pages: [],
  } as any

  it('passes cookie sessions to list and item reads', async () => {
    const session = { user: { id: 'user-1', email: 'user@example.com', name: 'User' } }
    const execute = vi.fn(async () => [])
    const findById = vi.fn(async () => ({ id: 'item-1' }))
    const app = new Hono()
    registerAPIRoutes(app, {
      blueprint,
      sessionManager: { getSession: async () => session } as any,
      queryExecutor: { execute, findById } as any,
      apiKeys: new Map(),
    })

    expect((await app.request('/api/items')).status).toBe(200)
    expect((await app.request('/api/items/item-1')).status).toBe(200)
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ entity: 'Item' }), { session })
    expect(findById).toHaveBeenCalledWith('Item', 'item-1', { session })
  })

  it('resolves API keys into sessions for generic entity reads', async () => {
    const execute = vi.fn(async () => [])
    const app = new Hono()
    registerAPIRoutes(app, {
      blueprint,
      sessionManager: { getSession: async () => null } as any,
      queryExecutor: { execute } as any,
      apiKeys: new Map([['secret-key', { name: 'roadmap-agent' }]]),
    })

    const response = await app.request('/api/items', {
      headers: { authorization: 'Bearer secret-key' },
    })

    expect(response.status).toBe(200)
    expect(execute.mock.calls[0]?.[1]?.session.user.id).toBe('roadmap-agent')
  })

  it('resolves API keys into sessions for generic entity mutations', async () => {
    const create = vi.fn(async () => ({ id: 'item-1' }))
    const app = new Hono()
    registerAPIRoutes(app, {
      blueprint,
      sessionManager: { getSession: async () => null } as any,
      queryExecutor: { create } as any,
      apiKeys: new Map([['secret-key', { name: 'roadmap-agent' }]]),
    })

    const response = await app.request('/api/items', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Agent item' }),
    })

    expect(response.status).toBe(201)
    expect(create.mock.calls[0]?.[2]?.session.user.id).toBe('roadmap-agent')
  })

  it('returns forbidden when query access is denied', async () => {
    const app = new Hono()
    registerAPIRoutes(app, {
      blueprint,
      sessionManager: { getSession: async () => null } as any,
      queryExecutor: { execute: async () => { throw new Error('Access denied: Cannot read Item') } } as any,
      apiKeys: new Map(),
    })

    const response = await app.request('/api/items')
    expect(response.status).toBe(403)
  })
})

describe('registerActionRoutes', () => {
  const session = { user: { id: 'user-1', email: 'user@example.com', name: 'User' } }
  const record = { id: 'item-1', status: 'candidate', title: 'Feature X' }

  function makeApp(overrides: {
    getSession?: () => any
    findById?: () => any
    getWorkflow?: () => any
    trigger?: () => any
  } = {}) {
    const app = new Hono()
    registerActionRoutes(app, {
      sessionManager: { getSession: overrides.getSession ?? (async () => session) } as any,
      queryExecutor: { findById: overrides.findById ?? vi.fn(async () => record) } as any,
      workflowManager: {
        getWorkflow: overrides.getWorkflow ?? vi.fn(() => ({ name: 'SetRoadmapStatus' })),
        trigger: overrides.trigger ?? vi.fn(() => ({ id: 'job-1', workflowName: 'SetRoadmapStatus' })),
      } as any,
    })
    return app
  }

  it('requires authentication', async () => {
    const trigger = vi.fn()
    const app = makeApp({ getSession: async () => null, trigger })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('returns 404 when the workflow does not exist', async () => {
    const app = makeApp({ getWorkflow: vi.fn(() => undefined) })

    const response = await app.request('/actions/NoSuchWorkflow', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toContain('NoSuchWorkflow')
  })

  it('loads the record with session context and triggers the workflow on a board card move', async () => {
    const findById = vi.fn(async () => record)
    const trigger = vi.fn(() => ({ id: 'job-1', workflowName: 'SetRoadmapStatus' }))

    const app = makeApp({ findById, trigger })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        entity: 'RoadmapItem',
        recordId: 'item-1',
        payload: JSON.stringify({ status: 'planned' }),
        redirect: '/board',
        successMessage: 'Roadmap status change started.',
      }),
    })

    expect(response.status).toBe(200)
    expect(findById).toHaveBeenCalledWith('RoadmapItem', 'item-1', { session })
    expect(trigger).toHaveBeenCalledWith(
      'SetRoadmapStatus',
      expect.objectContaining({
        record,
        payload: { status: 'planned' },
        entity: 'RoadmapItem',
        recordId: 'item-1',
        session,
      }),
      expect.anything()
    )
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.message).toBe('Roadmap status change started.')
  })

  it('redirects via 303 for form submissions (not JSON accept)', async () => {
    const app = makeApp()

    const params = new URLSearchParams({
      entity: 'RoadmapItem',
      recordId: 'item-1',
      payload: JSON.stringify({ status: 'in_progress' }),
      redirect: '/board',
      successMessage: 'Item moved.',
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      redirect: 'manual',
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/board')
  })
})

describe('registerSearchRoutes', () => {
  it('serves lookup widget search results using blueprint config and session context', async () => {
    const app = new Hono()
    const session = {
      id: 'sess-1',
      userId: 'user-1',
      user: { id: 'user-1', email: 'test@example.com' },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }
    const queryExecutor = {
      search: vi.fn(async () => ([
        { id: 'cus-1', firstName: 'Alice', lastName: 'Smith' },
      ])),
    }
    const sessionManager = {
      getSession: vi.fn(async () => session),
    }

    registerSearchRoutes(app, {
      blueprint: {
        version: '0.3.0',
        project: { name: 'test', version: '1.0.0', runtime: { min_version: '0.2.0' } },
        entities: [],
        pages: [
          {
            path: '/customers',
            title: 'Customer Search',
            widget: {
              kind: 'lookup',
              entity: 'Customer',
              search: ['lastName', 'firstName'],
              display: '{lastName}, {firstName}',
              limit: 5,
              filter: { status: 'active' },
            },
          },
        ],
      } as any,
      queryExecutor: queryExecutor as any,
      sessionManager: sessionManager as any,
    })

    const response = await app.request('/_widget/search?page=/customers&q=alice')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      results: [{ id: 'cus-1', label: 'Smith, Alice' }],
    })
    expect(sessionManager.getSession).toHaveBeenCalledTimes(1)
    expect(queryExecutor.search).toHaveBeenCalledWith(
      'Customer',
      ['lastName', 'firstName'],
      'alice',
      {
        limit: 5,
        filter: { status: 'active' },
        context: { session },
      }
    )
  })
})

function htmlAdapter(): BlueprintHttpAdapter {
  return {
    handle: async () => new Response('<html><body>OK</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
  } as BlueprintHttpAdapter
}
