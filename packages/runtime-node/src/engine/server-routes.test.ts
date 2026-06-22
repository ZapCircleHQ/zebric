import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { injectCsrfTokenIntoRequest } from '@zebric/runtime-core'
import type { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { registerAPIRoutes, registerPageRoutes } from './server-routes.js'

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

function htmlAdapter(): BlueprintHttpAdapter {
  return {
    handle: async () => new Response('<html><body>OK</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
  } as BlueprintHttpAdapter
}
