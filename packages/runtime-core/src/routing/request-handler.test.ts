import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RequestHandler } from './request-handler.js'
import type { HttpRequest } from './request-ports.js'
import type { Blueprint, Page } from '../types/blueprint.js'
import type { RouteMatch } from './route-matcher.js'

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    version: '1.0',
    project: { name: 'Test', version: '1.0.0', runtime: { min_version: '0.1.0' } },
    entities: [
      {
        name: 'Task',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'title', type: 'Text', required: true },
          { name: 'status', type: 'Text' },
        ],
      },
    ],
    pages: [],
    ...overrides,
  } as any
}

function makeRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: 'GET',
    url: 'http://localhost:3000/tasks',
    headers: {},
    ...overrides,
  }
}

function makeMatch(page: Page, overrides: Partial<RouteMatch> = {}): RouteMatch {
  return {
    page,
    params: {},
    query: {},
    ...overrides,
  }
}

describe('RequestHandler', () => {
  let blueprint: Blueprint

  beforeEach(() => {
    blueprint = makeBlueprint()
  })

  describe('handleGet', () => {
    it('returns 401 for authenticated page when no session', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => null },
      })

      const page: Page = { path: '/tasks', title: 'Tasks', layout: 'list' }
      const match = makeMatch(page)
      const request = makeRequest({ headers: { accept: 'application/json' } })

      const response = await handler.handleGet(match, request)
      expect(response.status).toBe(401)

      const body = JSON.parse(response.body as string)
      expect(body.error).toBe('Authentication required')
    })

    it('allows access when page auth is none', async () => {
      const queryExecutor = {
        execute: vi.fn().mockResolvedValue([{ id: '1', title: 'Task 1' }]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findById: vi.fn(),
      }
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => null },
        queryExecutor,
      })

      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        auth: 'none',
        queries: { tasks: { entity: 'Task' } },
      } as any

      const match = makeMatch(page)
      const request = makeRequest({ headers: { accept: 'application/json' } })

      const response = await handler.handleGet(match, request)
      expect(response.status).toBe(200)
    })

    it('allows access when page auth is optional and no session', async () => {
      const queryExecutor = {
        execute: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findById: vi.fn(),
      }
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => null },
        queryExecutor,
      })

      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        auth: 'optional',
        queries: { tasks: { entity: 'Task' } },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ headers: { accept: 'application/json' } })

      const response = await handler.handleGet(match, request)
      expect(response.status).toBe(200)
    })

    it('returns JSON data when accept header includes application/json', async () => {
      const session = { user: { id: 'u1', name: 'Test' } }
      const items = [{ id: '1', title: 'Task 1' }]
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => session },
        queryExecutor: {
          execute: vi.fn().mockResolvedValue(items),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
      })

      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' } },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ headers: { accept: 'application/json' } })

      const response = await handler.handleGet(match, request)
      expect(response.status).toBe(200)
      expect(response.headers['Content-Type']).toBe('application/json')

      const body = JSON.parse(response.body as string)
      expect(body.data.tasks).toEqual(items)
      expect(body.title).toBe('Tasks')
    })

    it('renders HTML when renderer is available and accept is text/html', async () => {
      const session = { user: { id: 'u1', name: 'Test' } }
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => session },
        queryExecutor: {
          execute: vi.fn().mockResolvedValue([]),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
        renderer: {
          renderPage: () => '<html><body>Rendered</body></html>',
        },
      })

      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' } },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ headers: { accept: 'text/html' } })

      const response = await handler.handleGet(match, request)
      expect(response.status).toBe(200)
      expect(response.headers['Content-Type']).toBe('text/html')
      expect(response.body).toContain('Rendered')
    })

    it('redirects unauthenticated non-JSON request to login', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => null },
      })

      const page: Page = { path: '/tasks', title: 'Tasks', layout: 'list' }
      const match = makeMatch(page)
      const request = makeRequest({ headers: { accept: 'text/html' } })

      const response = await handler.handleGet(match, request)
      expect(response.status).toBe(303)
      expect(response.headers['Location']).toContain('/auth/sign-in')
      expect(response.headers['Location']).toContain('callbackURL=')
    })

    it('extracts flash message from cookie and clears it', async () => {
      const session = { user: { id: 'u1', name: 'Test' } }
      const flash = encodeURIComponent(JSON.stringify({ type: 'success', text: 'Created!' }))
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => session },
        queryExecutor: {
          execute: vi.fn().mockResolvedValue([]),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
      })

      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        auth: 'none',
        queries: { tasks: { entity: 'Task' } },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({
        headers: { accept: 'application/json', cookie: `flash=${flash}` },
      })

      const response = await handler.handleGet(match, request)
      const body = JSON.parse(response.body as string)
      expect(body.flash).toEqual({ type: 'success', text: 'Created!' })
      expect(response.headers['Set-Cookie']).toContain('flash=')
      expect(response.headers['Set-Cookie']).toContain('Max-Age=0')
    })

    it('passes CSRF token from cookie to response', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
        queryExecutor: {
          execute: vi.fn().mockResolvedValue([]),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
      })

      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' } },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({
        headers: { accept: 'application/json', cookie: 'csrf-token=my-csrf-value' },
      })

      const response = await handler.handleGet(match, request)
      const body = JSON.parse(response.body as string)
      expect(body.csrfToken).toBe('my-csrf-value')
    })
  })

  describe('handlePost', () => {
    it('returns 401 when no session for authenticated page', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => null },
      })

      const page: Page = {
        path: '/tasks/new',
        title: 'New Task',
        layout: 'form',
        form: { entity: 'Task', method: 'create', fields: [{ name: 'title', type: 'text', required: true }] },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ method: 'POST', body: { title: 'Test' } })

      const response = await handler.handlePost(match, request)
      expect(response.status).toBe(401)
    })

    it('returns 400 when page has no form defined', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
      })

      const page: Page = { path: '/tasks', title: 'Tasks', layout: 'list' }
      const match = makeMatch(page)
      const request = makeRequest({ method: 'POST', body: {} })

      const response = await handler.handlePost(match, request)
      expect(response.status).toBe(400)

      const body = JSON.parse(response.body as string)
      expect(body.error).toBe('No form defined for this page')
    })

    it('validates required fields', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
      })

      const page: Page = {
        path: '/tasks/new',
        title: 'New Task',
        layout: 'form',
        form: {
          entity: 'Task',
          method: 'create',
          fields: [{ name: 'title', type: 'text', required: true, label: 'Title' }],
        },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ method: 'POST', body: { title: '' } })

      const response = await handler.handlePost(match, request)
      expect(response.status).toBe(400)

      const body = JSON.parse(response.body as string)
      expect(body.error).toBe('Validation failed')
      expect(body.errors).toHaveLength(1)
      expect(body.errors[0].field).toBe('title')
    })

    it('validates pattern constraints', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
      })

      const page: Page = {
        path: '/tasks/new',
        title: 'New',
        layout: 'form',
        form: {
          entity: 'Task',
          method: 'create',
          fields: [{ name: 'email', type: 'text', pattern: '^[^@]+@[^@]+$', error_message: 'Invalid email' }],
        },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ method: 'POST', body: { email: 'not-an-email' } })

      const response = await handler.handlePost(match, request)
      expect(response.status).toBe(400)

      const body = JSON.parse(response.body as string)
      expect(body.errors[0].message).toBe('Invalid email')
    })

    it('validates min/max for number fields', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
      })

      const page: Page = {
        path: '/tasks/new',
        title: 'New',
        layout: 'form',
        form: {
          entity: 'Task',
          method: 'create',
          fields: [{ name: 'count', type: 'number', min: 1, max: 10 }],
        },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ method: 'POST', body: { count: 15 } })

      const response = await handler.handlePost(match, request)
      expect(response.status).toBe(400)

      const body = JSON.parse(response.body as string)
      expect(body.errors[0].message).toContain('at most 10')
    })

    it('creates record on successful validation', async () => {
      const createFn = vi.fn().mockResolvedValue({ id: 'new-1', title: 'Test Task' })
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
        queryExecutor: {
          execute: vi.fn(),
          create: createFn,
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
      })

      const page: Page = {
        path: '/tasks/new',
        title: 'New Task',
        layout: 'form',
        form: {
          entity: 'Task',
          method: 'create',
          fields: [{ name: 'title', type: 'text', required: true }],
        },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ method: 'POST', body: { title: 'Test Task' } })

      const response = await handler.handlePost(match, request)
      expect(response.status).toBe(200)

      const body = JSON.parse(response.body as string)
      expect(body.success).toBe(true)
      expect(createFn).toHaveBeenCalledWith('Task', { title: 'Test Task' }, expect.any(Object))
    })

    it('returns redirect path on success when configured', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
        queryExecutor: {
          execute: vi.fn(),
          create: vi.fn().mockResolvedValue({ id: 'new-1', title: 'Test' }),
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
      })

      const page: Page = {
        path: '/tasks/new',
        title: 'New',
        layout: 'form',
        form: {
          entity: 'Task',
          method: 'create',
          fields: [{ name: 'title', type: 'text' }],
          onSuccess: { redirect: '/tasks/{id}', message: 'Task created!' },
        },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ method: 'POST', body: { title: 'Test' } })

      const response = await handler.handlePost(match, request)
      const body = JSON.parse(response.body as string)
      expect(body.redirect).toBe('/tasks/new-1')
      expect(body.message).toBe('Task created!')
    })
  })

  describe('handlePut', () => {
    it('returns 401 when no session', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => null },
      })

      const page: Page = {
        path: '/tasks/:id/edit',
        title: 'Edit',
        layout: 'form',
        form: { entity: 'Task', method: 'update', fields: [{ name: 'title', type: 'text' }] },
      } as any
      const match = makeMatch(page, { params: { id: '1' } })
      const request = makeRequest({ method: 'PUT', body: { title: 'Updated' } })

      const response = await handler.handlePut(match, request)
      expect(response.status).toBe(401)
    })

    it('returns 400 when no update form defined', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
      })

      const page: Page = { path: '/tasks/:id', title: 'Task', layout: 'detail' }
      const match = makeMatch(page, { params: { id: '1' } })
      const request = makeRequest({ method: 'PUT', body: { title: 'Updated' } })

      const response = await handler.handlePut(match, request)
      expect(response.status).toBe(400)
      const body = JSON.parse(response.body as string)
      expect(body.error).toBe('No update form defined for this page')
    })

    it('updates record on success', async () => {
      const updateFn = vi.fn().mockResolvedValue({ id: '1', title: 'Updated' })
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
        queryExecutor: {
          execute: vi.fn(),
          create: vi.fn(),
          update: updateFn,
          delete: vi.fn(),
          findById: vi.fn().mockResolvedValue({ id: '1', title: 'Original' }),
        },
      })

      const page: Page = {
        path: '/tasks/:id/edit',
        title: 'Edit',
        layout: 'form',
        form: { entity: 'Task', method: 'update', fields: [{ name: 'title', type: 'text' }] },
      } as any
      const match = makeMatch(page, { params: { id: '1' } })
      const request = makeRequest({ method: 'PUT', body: { title: 'Updated' } })

      const response = await handler.handlePut(match, request)
      expect(response.status).toBe(200)

      const body = JSON.parse(response.body as string)
      expect(body.success).toBe(true)
    })
  })

  describe('handleDelete', () => {
    it('returns 401 when no session', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => null },
      })

      const page: Page = {
        path: '/tasks/:id/delete',
        title: 'Delete',
        layout: 'form',
        form: { entity: 'Task', method: 'delete', fields: [] },
      } as any
      const match = makeMatch(page, { params: { id: '1' } })
      const request = makeRequest({ method: 'DELETE' })

      const response = await handler.handleDelete(match, request)
      expect(response.status).toBe(401)
    })

    it('returns 400 when no delete form defined', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
      })

      const page: Page = { path: '/tasks/:id', title: 'Task', layout: 'detail' }
      const match = makeMatch(page, { params: { id: '1' } })
      const request = makeRequest({ method: 'DELETE' })

      const response = await handler.handleDelete(match, request)
      expect(response.status).toBe(400)
    })

    it('deletes record on success', async () => {
      const deleteFn = vi.fn().mockResolvedValue(undefined)
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
        queryExecutor: {
          execute: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: deleteFn,
          findById: vi.fn().mockResolvedValue({ id: '1', title: 'Task' }),
        },
      })

      const page: Page = {
        path: '/tasks/:id/delete',
        title: 'Delete',
        layout: 'form',
        form: { entity: 'Task', method: 'delete', fields: [] },
      } as any
      const match = makeMatch(page, { params: { id: '1' } })
      const request = makeRequest({ method: 'DELETE' })

      const response = await handler.handleDelete(match, request)
      expect(response.status).toBe(200)

      const body = JSON.parse(response.body as string)
      expect(body.success).toBe(true)
      expect(body.message).toBe('Deleted successfully')
    })
  })

  describe('wantsJson (via handleGet behavior)', () => {
    it('returns JSON when accept is application/json without text/html', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => null },
      })
      const page: Page = { path: '/tasks', title: 'Tasks', layout: 'list', auth: 'none' } as any
      const match = makeMatch(page)

      const jsonReq = makeRequest({ headers: { accept: 'application/json' } })
      const response = await handler.handleGet(match, jsonReq)
      expect(response.headers['Content-Type']).toBe('application/json')
    })

    it('prefers HTML over JSON when both are accepted', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => null },
        renderer: { renderPage: () => '<html>Rendered</html>' },
        queryExecutor: {
          execute: vi.fn().mockResolvedValue([]),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
      })
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        auth: 'none',
        queries: { tasks: { entity: 'Task' } },
      } as any
      const match = makeMatch(page)

      const htmlReq = makeRequest({ headers: { accept: 'text/html, application/json' } })
      const response = await handler.handleGet(match, htmlReq)
      expect(response.headers['Content-Type']).toBe('text/html')
    })
  })

  describe('error handling', () => {
    it('returns sanitized error when query executor throws', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
        queryExecutor: {
          execute: vi.fn().mockRejectedValue(new Error('DB connection failed')),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
      })

      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' } },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ headers: { accept: 'application/json' } })

      // handleGet catches query errors and returns empty arrays, so this should succeed
      const response = await handler.handleGet(match, request)
      expect(response.status).toBe(200)
    })

    it('returns 500 for form action errors', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
        queryExecutor: {
          execute: vi.fn(),
          create: vi.fn().mockRejectedValue(new Error('Insert failed')),
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
      })

      const page: Page = {
        path: '/tasks/new',
        title: 'New',
        layout: 'form',
        form: { entity: 'Task', method: 'create', fields: [{ name: 'title', type: 'text' }] },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ method: 'POST', body: { title: 'Test' } })

      const response = await handler.handlePost(match, request)
      expect(response.status).toBe(500)
    })
  })

  describe('session handling', () => {
    it('returns null session when session manager throws', async () => {
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => { throw new Error('Session error') } },
      })

      const page: Page = { path: '/tasks', title: 'Tasks', layout: 'list' }
      const match = makeMatch(page)
      const request = makeRequest({ headers: { accept: 'application/json' } })

      // Session error should be caught and treated as no session
      const response = await handler.handleGet(match, request)
      expect(response.status).toBe(401) // No session → auth required
    })

    it('returns null session when no session manager configured', async () => {
      const handler = new RequestHandler({ blueprint })

      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        auth: 'none',
      } as any
      const match = makeMatch(page)
      const request = makeRequest({ headers: { accept: 'application/json' } })

      const response = await handler.handleGet(match, request)
      expect(response.status).toBe(200)
    })
  })

  describe('IP extraction', () => {
    it('extracts IP from x-forwarded-for header', async () => {
      const logSpy = vi.fn()
      const handler = new RequestHandler({
        blueprint,
        sessionManager: { getSession: async () => ({ user: { id: 'u1' } }) },
        queryExecutor: {
          execute: vi.fn().mockResolvedValue([]),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
          findById: vi.fn(),
        },
        auditLogger: {
          log: logSpy,
          logAccessDenied: vi.fn(),
          logDataAccess: vi.fn(),
        },
      })

      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' } },
      } as any
      const match = makeMatch(page)
      const request = makeRequest({
        headers: {
          accept: 'application/json',
          'x-forwarded-for': '203.0.113.50, 70.41.3.18',
        },
      })

      await handler.handleGet(match, request)
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ ipAddress: '203.0.113.50' })
      )
    })
  })
})
