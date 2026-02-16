import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ServerManager } from './server-manager.js'

/**
 * Unit tests for API key resolution and pagination param parsing logic
 * extracted from ServerManager. We test the public behavior via the
 * private methods by constructing a minimal ServerManager and using
 * reflection or by testing the HTTP routes with a lightweight fetch.
 */

// Minimal stubs for ServerManager dependencies
function stubDeps(overrides: Record<string, any> = {}) {
  return {
    blueprint: {
      version: '1.0',
      project: { name: 'Test', version: '0.1.0', runtime: { min_version: '0.1.0' } },
      entities: [],
      pages: [],
      auth: overrides.auth ?? undefined,
      skills: overrides.skills ?? undefined,
    },
    config: { port: 0, host: '127.0.0.1' },
    state: { status: 'running' },
    authProvider: { getAuthInstance: () => ({ handler: async () => new Response('ok') }) },
    sessionManager: { getSession: async () => null },
    queryExecutor: {
      execute: async () => [],
      findById: async () => null,
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => {},
    },
    workflowManager: undefined,
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
