import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { injectCsrfTokenIntoRequest } from '@zebric/runtime-core'
import type { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { registerPageRoutes, registerSearchRoutes } from './server-routes.js'

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
