import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { injectCsrfTokenIntoRequest } from '@zebric/runtime-core'
import type { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { registerPageRoutes, registerSearchRoutes, registerWidgetRoutes } from './server-routes.js'

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

  it('requires authentication for secure-by-default lookup pages', async () => {
    const app = new Hono()
    const queryExecutor = {
      search: vi.fn(async () => []),
    }
    const sessionManager = {
      getSession: vi.fn(async () => null),
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
            },
          },
        ],
      } as any,
      queryExecutor: queryExecutor as any,
      sessionManager: sessionManager as any,
    })

    const response = await app.request('/_widget/search?page=/customers&q=alice')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Authentication required',
      message: 'You must be logged in to access this page',
    })
    expect(queryExecutor.search).not.toHaveBeenCalled()
  })
})

describe('registerWidgetRoutes', () => {
  it('requires authentication for secure-by-default widget pages', async () => {
    const app = new Hono()
    const queryExecutor = {
      findById: vi.fn(async () => ({ id: 'task-1', status: 'todo' })),
      update: vi.fn(async () => ({ id: 'task-1', status: 'done' })),
    }
    const sessionManager = {
      getSession: vi.fn(async () => null),
    }

    registerWidgetRoutes(app, {
      blueprint: {
        version: '0.3.0',
        project: { name: 'test', version: '1.0.0', runtime: { min_version: '0.2.0' } },
        entities: [],
        pages: [
          {
            path: '/board',
            title: 'Board',
            widget: {
              kind: 'board',
              on_toggle: {
                update: { status: '$value' },
              },
            },
          },
        ],
      } as any,
      queryExecutor: queryExecutor as any,
      sessionManager: sessionManager as any,
    })

    const response = await app.request('/_widget/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        page: '/board',
        event: 'toggle',
        row: { entity: 'Task', id: 'task-1' },
        ctx: { value: 'done' },
      }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Authentication required',
      message: 'You must be logged in to access this page',
    })
    expect(queryExecutor.update).not.toHaveBeenCalled()
  })
})

function htmlAdapter(): BlueprintHttpAdapter {
  return {
    handle: async () => new Response('<html><body>OK</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
  } as BlueprintHttpAdapter
}
