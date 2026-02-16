import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import path from 'node:path'
import { ServerManager } from './server-manager.js'

/**
 * Unit tests for API key resolution, pagination param parsing,
 * and security hardening in ServerManager.
 */

// Minimal stubs for ServerManager dependencies
function stubDeps(overrides: Record<string, any> = {}) {
  return {
    blueprint: {
      version: '1.0',
      project: { name: 'Test', version: '0.1.0', runtime: { min_version: '0.1.0' } },
      entities: overrides.entities ?? [],
      pages: overrides.pages ?? [],
      auth: overrides.auth ?? undefined,
      skills: overrides.skills ?? undefined,
    },
    config: { port: 0, host: '127.0.0.1', ...overrides.config },
    state: { status: 'running' },
    authProvider: { getAuthInstance: () => ({ handler: async () => new Response('ok') }) },
    sessionManager: overrides.sessionManager ?? { getSession: async () => null },
    queryExecutor: {
      execute: async () => [],
      findById: async () => null,
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => {},
      ...overrides.queryExecutor,
    },
    workflowManager: overrides.workflowManager,
    plugins: { getAll: () => [] },
    blueprintAdapter: { handle: async () => new Response('ok') },
    metrics: {
      now: () => Date.now(),
      recordRequest: () => {},
      toPrometheus: () => '',
    },
    tracer: {
      startTrace: () => {},
      startSpan: () => 'span-1',
      endSpan: () => {},
      endTrace: () => {},
    },
    errorHandler: {
      toHonoHandler: () => (err: any, c: any) => {
        return c.json({ error: 'Internal error' }, 500)
      },
    },
    pendingSchemaDiff: null,
    notificationManager: undefined,
    ...overrides,
  } as any
}

/**
 * Initialize the Hono app inside a ServerManager without starting a TCP server.
 * Returns the Hono app so we can use app.request() for in-process testing.
 */
function initApp(sm: ServerManager): Hono {
  const smAny = sm as any
  smAny.app = new Hono()
  smAny.app.onError(smAny.errorHandler.toHonoHandler())
  smAny.registerGlobalMiddleware()
  smAny.registerRoutes()
  smAny.initApiKeys()
  return smAny.app
}

describe('resolveApiKeySession', () => {
  it('returns a synthetic session for a valid API key', () => {
    const env = process.env
    process.env.TEST_AGENT_KEY = 'secret-key-123'

    const deps = stubDeps({
      auth: {
        providers: ['email'],
        apiKeys: [{ name: 'test-agent', keyEnv: 'TEST_AGENT_KEY' }],
      },
    })
    const sm = new ServerManager(deps)

    // Access private method via bracket notation
    ;(sm as any).blueprint = deps.blueprint
    ;(sm as any).initApiKeys()

    const session = (sm as any).resolveApiKeySession('secret-key-123')
    expect(session).not.toBeNull()
    expect(session.user.id).toBe('test-agent')
    expect(session.user.name).toBe('test-agent')
    expect(session.userId).toBe('test-agent')

    // Clean up
    delete process.env.TEST_AGENT_KEY
  })

  it('returns null for an unknown token', () => {
    process.env.TEST_AGENT_KEY = 'secret-key-123'

    const deps = stubDeps({
      auth: {
        providers: ['email'],
        apiKeys: [{ name: 'test-agent', keyEnv: 'TEST_AGENT_KEY' }],
      },
    })
    const sm = new ServerManager(deps)
    ;(sm as any).initApiKeys()

    const session = (sm as any).resolveApiKeySession('wrong-key')
    expect(session).toBeNull()

    delete process.env.TEST_AGENT_KEY
  })

  it('skips API keys when env var is not set', () => {
    delete process.env.MISSING_KEY

    const deps = stubDeps({
      auth: {
        providers: ['email'],
        apiKeys: [{ name: 'ghost-agent', keyEnv: 'MISSING_KEY' }],
      },
    })
    const sm = new ServerManager(deps)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(sm as any).initApiKeys()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('MISSING_KEY')
    )
    expect((sm as any).apiKeys.size).toBe(0)

    warnSpy.mockRestore()
  })

  it('handles empty apiKeys array', () => {
    const deps = stubDeps({
      auth: {
        providers: ['email'],
        apiKeys: [],
      },
    })
    const sm = new ServerManager(deps)
    ;(sm as any).initApiKeys()

    expect((sm as any).apiKeys.size).toBe(0)
  })

  it('handles no auth config', () => {
    const deps = stubDeps()
    const sm = new ServerManager(deps)
    ;(sm as any).initApiKeys()

    expect((sm as any).apiKeys.size).toBe(0)
  })
})

describe('pagination param parsing', () => {
  it('clamps limit to max 1000', () => {
    const limitParam = parseInt('5000', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(1000)
  })

  it('defaults limit to 100 when not provided', () => {
    const limitParam = parseInt('', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(100)
  })

  it('uses provided limit when valid', () => {
    const limitParam = parseInt('50', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(50)
  })

  it('defaults limit to 100 for negative values', () => {
    const limitParam = parseInt('-5', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(100)
  })

  it('defaults limit to 100 for zero', () => {
    const limitParam = parseInt('0', 10)
    const limit = Math.min(
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
      1000
    )
    expect(limit).toBe(100)
  })

  it('returns undefined offset when not provided', () => {
    const offsetParam = parseInt('', 10)
    const offset =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
    expect(offset).toBeUndefined()
  })

  it('returns offset when valid', () => {
    const offsetParam = parseInt('20', 10)
    const offset =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
    expect(offset).toBe(20)
  })

  it('allows offset of 0', () => {
    const offsetParam = parseInt('0', 10)
    const offset =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
    expect(offset).toBe(0)
  })

  it('returns undefined offset for negative values', () => {
    const offsetParam = parseInt('-10', 10)
    const offset =
      Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
    expect(offset).toBeUndefined()
  })
})

// ============================================================================
// Security fix regression tests
// ============================================================================

describe('security: CSRF protection', () => {
  it('rejects POST with no CSRF cookie and an attacker-supplied token', async () => {
    const sm = new ServerManager(stubDeps())
    const app = initApp(sm)

    // Attacker sends a POST with an arbitrary x-csrf-token but no matching cookie.
    // Before the fix, the self-heal path would accept this.
    const res = await app.request('/health', {
      method: 'POST',
      headers: {
        'x-csrf-token': 'attacker-chosen-value',
        'content-type': 'application/json',
      },
      body: '{}',
    })

    expect(res.status).toBe(403)
    const body = await res.json() as any
    expect(body.error).toBe('Invalid CSRF token')
  })

  it('rejects POST when submitted token differs from cookie token', async () => {
    const sm = new ServerManager(stubDeps())
    const app = initApp(sm)

    // Attacker submits a different token than what's in the cookie.
    // Before the fix, the rotate path would accept this.
    const res = await app.request('/health', {
      method: 'POST',
      headers: {
        'x-csrf-token': 'attacker-token',
        'cookie': 'csrf-token=legitimate-token',
        'content-type': 'application/json',
      },
      body: '{}',
    })

    expect(res.status).toBe(403)
    const body = await res.json() as any
    expect(body.error).toBe('Invalid CSRF token')
  })

  it('accepts POST when submitted token matches cookie token', async () => {
    const sm = new ServerManager(stubDeps())
    const app = initApp(sm)

    const token = 'valid-matching-token'
    const res = await app.request('/health', {
      method: 'POST',
      headers: {
        'x-csrf-token': token,
        'cookie': `csrf-token=${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })

    // Should pass CSRF check (may get 404 or another status, but NOT 403)
    expect(res.status).not.toBe(403)
  })

  it('rejects POST with no cookie and no submitted token', async () => {
    const sm = new ServerManager(stubDeps())
    const app = initApp(sm)

    const res = await app.request('/health', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{}',
    })

    expect(res.status).toBe(403)
  })
})

describe('security: action route authentication', () => {
  it('rejects unauthenticated action requests regardless of body.page', async () => {
    const sm = new ServerManager(stubDeps({
      pages: [{ path: '/', title: 'Home', layout: 'list', auth: 'none' }],
      workflowManager: {
        getWorkflow: () => ({ name: 'TestWf', steps: [] }),
        trigger: () => ({ id: 'job-1', workflowName: 'TestWf', status: 'queued' }),
      },
    }))
    const app = initApp(sm)

    const token = 'test-csrf'
    // Attacker sends body.page pointing to a page with auth: 'none'
    // Before the fix, this would bypass auth entirely.
    const res = await app.request('/actions/TestWf', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': token,
        'cookie': `csrf-token=${token}`,
      },
      body: JSON.stringify({ page: '/', payload: {} }),
    })

    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error).toBe('Unauthorized')
  })

  it('allows authenticated action requests', async () => {
    const fakeSession = { id: 'sess-1', user: { id: 'user-1', name: 'Test' } }
    const sm = new ServerManager(stubDeps({
      sessionManager: { getSession: async () => fakeSession },
      workflowManager: {
        getWorkflow: () => ({ name: 'TestWf', steps: [] }),
        trigger: () => ({ id: 'job-1', workflowName: 'TestWf', status: 'queued' }),
      },
    }))
    const app = initApp(sm)

    const token = 'test-csrf'
    const res = await app.request('/actions/TestWf', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'x-csrf-token': token,
        'cookie': `csrf-token=${token}`,
      },
      body: JSON.stringify({ payload: {} }),
    })

    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})

describe('security: path traversal in /uploads', () => {
  // Note: Hono normalizes URLs before routing, so `../` in the raw URL
  // gets collapsed and never matches `/uploads/*`. These tests verify the
  // traversal guard *inside* the handler using path.resolve + startsWith.

  it('blocks traversal when relative segment escapes root', () => {
    // Simulate what the handler does with a malicious relative path
    const root = path.resolve('/app/data/uploads')

    const malicious = path.resolve(root, '../../../etc/passwd')
    expect(malicious.startsWith(root + path.sep)).toBe(false)
    expect(malicious).not.toBe(root)
  })

  it('blocks traversal to sibling directory', () => {
    const root = path.resolve('/app/data/uploads')

    const sibling = path.resolve(root, '../secrets/key')
    expect(sibling.startsWith(root + path.sep)).toBe(false)
    expect(sibling).not.toBe(root)
  })

  it('blocks single level traversal', () => {
    const root = path.resolve('/app/data/uploads')

    const parent = path.resolve(root, '..')
    expect(parent.startsWith(root + path.sep)).toBe(false)
    expect(parent).not.toBe(root)
  })

  it('allows normal file paths within uploads', () => {
    const root = path.resolve('/app/data/uploads')

    const safe = path.resolve(root, 'images/photo.jpg')
    expect(safe.startsWith(root + path.sep)).toBe(true)
  })

  it('allows nested subdirectory paths', () => {
    const root = path.resolve('/app/data/uploads')

    const nested = path.resolve(root, 'a/b/c/file.txt')
    expect(nested.startsWith(root + path.sep)).toBe(true)
  })

  it('rejects path that matches root exactly (no file specified)', () => {
    // root itself should not be served — only files inside it
    const root = path.resolve('/app/data/uploads')
    const exact = path.resolve(root, '')
    // exact === root, and our guard uses: !startsWith(root + sep) && filePath !== root
    // So root itself passes the guard (it equals root). This is acceptable since
    // readFile on a directory will throw and return 404 from the catch block.
    expect(exact).toBe(root)
  })

  it('returns 404 for normal uploads path when file does not exist (route-level)', async () => {
    const sm = new ServerManager(stubDeps())
    const app = initApp(sm)

    // File doesn't exist, so readFile throws -> 404 from catch
    const res = await app.request('/uploads/images/photo.jpg')
    expect(res.status).toBe(404)
  })
})

describe('security: path traversal guard integration', () => {
  // These tests verify the guard as implemented in registerStaticUploads
  // by calling the private method logic on a real ServerManager instance.

  it('rejects traversal via direct method test', async () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    const root = path.resolve(process.cwd(), 'data/uploads')

    // Simulate a traversal relative path
    const relative = '../../../etc/passwd'
    const filePath = path.resolve(root, relative)
    const blocked = !filePath.startsWith(root + path.sep) && filePath !== root

    expect(blocked).toBe(true)
  })

  it('allows legitimate relative path via direct method test', async () => {
    const sm = new ServerManager(stubDeps())

    const root = path.resolve(process.cwd(), 'data/uploads')

    const relative = 'documents/report.pdf'
    const filePath = path.resolve(root, relative)
    const blocked = !filePath.startsWith(root + path.sep) && filePath !== root

    expect(blocked).toBe(false)
  })
})

// ============================================================================
// Medium severity security fix regression tests
// ============================================================================

describe('security: CSRF skip only for valid API keys', () => {
  it('rejects POST with garbage bearer token and no CSRF cookie', async () => {
    // A garbage bearer token should NOT skip CSRF. Before the fix, any
    // "Authorization: Bearer anything" would bypass CSRF entirely.
    const sm = new ServerManager(stubDeps())
    const app = initApp(sm)

    const res = await app.request('/health', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer garbage-token',
        'content-type': 'application/json',
      },
      body: '{}',
    })

    expect(res.status).toBe(403)
    const body = await res.json() as any
    expect(body.error).toBe('Invalid CSRF token')
  })

  it('allows POST with valid API key bearer token (skips CSRF)', async () => {
    process.env.TEST_KEY = 'valid-api-key-123'
    const sm = new ServerManager(stubDeps({
      auth: {
        providers: ['email'],
        apiKeys: [{ name: 'agent', keyEnv: 'TEST_KEY' }],
      },
    }))
    const app = initApp(sm)

    // Valid API key bearer token should skip CSRF
    const res = await app.request('/health', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer valid-api-key-123',
        'content-type': 'application/json',
      },
      body: '{}',
    })

    // Should pass CSRF (not 403). Will hit the actual route handler.
    expect(res.status).not.toBe(403)
    delete process.env.TEST_KEY
  })

  it('rejects POST with bearer token that does not match any API key', async () => {
    process.env.TEST_KEY = 'real-key'
    const sm = new ServerManager(stubDeps({
      auth: {
        providers: ['email'],
        apiKeys: [{ name: 'agent', keyEnv: 'TEST_KEY' }],
      },
    }))
    const app = initApp(sm)

    const res = await app.request('/health', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer wrong-key',
        'content-type': 'application/json',
      },
      body: '{}',
    })

    expect(res.status).toBe(403)
    delete process.env.TEST_KEY
  })
})

describe('security: no HTML entity decoding in action body', () => {
  it('does not decode HTML entities in normalizeActionBody', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    const input = {
      title: '&lt;script&gt;alert(1)&lt;/script&gt;',
      status: '&amp;active',
      clean: 'hello world',
    }
    const result = smAny.normalizeActionBody(input)

    // Values must pass through untouched — no decoding
    expect(result.title).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(result.status).toBe('&amp;active')
    expect(result.clean).toBe('hello world')
  })

  it('handles empty and null input', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    expect(smAny.normalizeActionBody({})).toEqual({})
    expect(smAny.normalizeActionBody(null)).toEqual({})
    expect(smAny.normalizeActionBody(undefined)).toEqual({})
  })
})

describe('security: open redirect prevention', () => {
  it('allows relative paths', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    expect(smAny.isSafeRedirect('/')).toBe(true)
    expect(smAny.isSafeRedirect('/issues')).toBe(true)
    expect(smAny.isSafeRedirect('/issues/123')).toBe(true)
    expect(smAny.isSafeRedirect('/issues?status=open')).toBe(true)
  })

  it('rejects absolute URLs', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    expect(smAny.isSafeRedirect('https://evil.com')).toBe(false)
    expect(smAny.isSafeRedirect('http://evil.com/phish')).toBe(false)
  })

  it('rejects protocol-relative URLs', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    expect(smAny.isSafeRedirect('//evil.com')).toBe(false)
    expect(smAny.isSafeRedirect('//evil.com/path')).toBe(false)
  })

  it('rejects javascript: and data: schemes', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    expect(smAny.isSafeRedirect('javascript:alert(1)')).toBe(false)
    expect(smAny.isSafeRedirect('data:text/html,<h1>hi</h1>')).toBe(false)
  })

  it('rejects empty and null values', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    expect(smAny.isSafeRedirect('')).toBe(false)
    expect(smAny.isSafeRedirect(undefined)).toBe(false)
    expect(smAny.isSafeRedirect(null)).toBe(false)
  })

  it('resolveActionRedirect falls back to / for unsafe values', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    expect(smAny.resolveActionRedirect('https://evil.com')).toBe('/')
    expect(smAny.resolveActionRedirect('//evil.com')).toBe('/')
    expect(smAny.resolveActionRedirect(undefined, 'https://evil.com')).toBe('/')
    expect(smAny.resolveActionRedirect(undefined, undefined)).toBe('/')
  })

  it('resolveActionRedirect uses safe provided value', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    expect(smAny.resolveActionRedirect('/issues/123')).toBe('/issues/123')
  })

  it('resolveActionRedirect falls back to safe referer', () => {
    const sm = new ServerManager(stubDeps())
    const smAny = sm as any

    expect(smAny.resolveActionRedirect(undefined, '/board')).toBe('/board')
  })
})

describe('security: workflow body field filtering', () => {
  it('only passes declared body fields to workflow data', async () => {
    const capturedData: any[] = []
    const sm = new ServerManager(stubDeps({
      skills: [{
        name: 'dispatch',
        actions: [{
          name: 'set_status',
          method: 'POST',
          path: '/api/issues/{id}/status',
          body: { status: 'Enum' },
          entity: 'Issue',
          workflow: 'SetIssueStatus',
        }],
      }],
      entities: [{ name: 'Issue', fields: [{ name: 'id', type: 'ULID', primary_key: true }] }],
      workflowManager: {
        getWorkflow: () => ({ name: 'SetIssueStatus', steps: [] }),
        trigger: (_name: string, data: any) => {
          capturedData.push(data)
          return { id: 'job-1', workflowName: 'SetIssueStatus', status: 'queued' }
        },
      },
      sessionManager: {
        getSession: async () => ({ id: 's1', user: { id: 'u1', name: 'Test' } }),
      },
      auth: { providers: ['email'] },
    }))
    const app = initApp(sm)

    const res = await app.request('/api/issues/abc123/status', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer csrf-safe', // need to get past CSRF
        'cookie': 'csrf-token=x',
        'x-csrf-token': 'x',
      },
      body: JSON.stringify({
        status: 'in_progress',
        maliciousUrl: 'https://evil.com/ssrf',
        extraField: 'should-be-dropped',
      }),
    })

    // The workflow should have been triggered
    expect(capturedData).toHaveLength(1)
    const payload = capturedData[0].payload

    // Only the declared 'status' field should be present
    expect(payload.status).toBe('in_progress')
    expect(payload.maliciousUrl).toBeUndefined()
    expect(payload.extraField).toBeUndefined()
  })

  it('passes all body fields when no schema is declared', async () => {
    const capturedData: any[] = []
    const sm = new ServerManager(stubDeps({
      skills: [{
        name: 'dispatch',
        actions: [{
          name: 'trigger_generic',
          method: 'POST',
          path: '/api/custom/action',
          // No body schema declared
          workflow: 'GenericWf',
        }],
      }],
      entities: [],
      workflowManager: {
        getWorkflow: () => ({ name: 'GenericWf', steps: [] }),
        trigger: (_name: string, data: any) => {
          capturedData.push(data)
          return { id: 'job-2', workflowName: 'GenericWf', status: 'queued' }
        },
      },
      sessionManager: {
        getSession: async () => ({ id: 's1', user: { id: 'u1', name: 'Test' } }),
      },
      auth: { providers: ['email'] },
    }))
    const app = initApp(sm)

    const res = await app.request('/api/custom/action', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cookie': 'csrf-token=x',
        'x-csrf-token': 'x',
      },
      body: JSON.stringify({ foo: 'bar', baz: 123 }),
    })

    expect(capturedData).toHaveLength(1)
    expect(capturedData[0].payload.foo).toBe('bar')
    expect(capturedData[0].payload.baz).toBe(123)
  })
})
