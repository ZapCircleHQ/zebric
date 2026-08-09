import { describe, it, expect, vi } from 'vitest'
import {
  initApiKeys,
  resolveApiKeySession,
  resolveAgentAttribution,
  createApiKeyRegistry,
  normalizeCsrfToken,
} from './server-security.js'
import type { Blueprint } from '@zebric/runtime-core'

function makeBlueprint(auth?: any): Blueprint {
  return {
    version: '1.0',
    project: { name: 'Test', version: '0.1.0', runtime: { min_version: '0.1.0' } },
    entities: [],
    pages: [],
    auth,
  } as any
}

describe('initApiKeys', () => {
  it('populates map from env vars', () => {
    process.env.TEST_AGENT_KEY = 'secret-key-123'

    const apiKeys = initApiKeys(makeBlueprint({
      providers: ['email'],
      apiKeys: [{ name: 'test-agent', keyEnv: 'TEST_AGENT_KEY' }],
    }))

    expect(apiKeys.size).toBe(1)
    expect([...apiKeys.values()]).toEqual([{
      name: 'test-agent',
      agentId: 'test-agent',
      credentialId: 'test-agent',
      displayName: 'test-agent',
      scopes: [],
    }])
    expect([...apiKeys.keys()][0]).not.toContain('secret-key-123')

    delete process.env.TEST_AGENT_KEY
  })

  it('warns and skips when env var is not set', () => {
    delete process.env.MISSING_KEY

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const apiKeys = initApiKeys(makeBlueprint({
      providers: ['email'],
      apiKeys: [{ name: 'ghost-agent', keyEnv: 'MISSING_KEY' }],
    }))

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('MISSING_KEY')
    )
    expect(apiKeys.size).toBe(0)

    warnSpy.mockRestore()
  })

  it('handles empty apiKeys array', () => {
    const apiKeys = initApiKeys(makeBlueprint({
      providers: ['email'],
      apiKeys: [],
    }))

    expect(apiKeys.size).toBe(0)
  })

  it('handles no auth config', () => {
    const apiKeys = initApiKeys(makeBlueprint())
    expect(apiKeys.size).toBe(0)
  })
})

describe('resolveApiKeySession', () => {
  it('returns a synthetic session for a valid API key', () => {
    const apiKeys = registry('secret-key-123', 'test-agent')

    const session = resolveApiKeySession('secret-key-123', apiKeys)
    expect(session).not.toBeNull()
    expect(session.user.id).toBe('test-agent')
    expect(session.user.name).toBe('test-agent')
    expect(session.userId).toBe('test-agent')
    expect(session.actor).toEqual({
      type: 'agent',
      id: 'test-agent',
      credentialId: 'test-agent',
      displayName: 'test-agent',
      scopes: [],
    })
  })

  it('returns null for an unknown token', () => {
    const apiKeys = registry('secret-key-123', 'test-agent')

    const session = resolveApiKeySession('wrong-key', apiKeys)
    expect(session).toBeNull()
  })
})

describe('resolveAgentAttribution', () => {
  const session = resolveApiKeySession('key', createApiKeyRegistry([{ token: 'key', credential: {
    name: 'qa-key', agentId: 'qa-agent', credentialId: 'credential-7',
    displayName: 'QA Agent', scopes: [],
  } }]))!

  it('binds the authenticated agent and credential to a bounded run ID', () => {
    const c = { req: { header: (name: string) => name === 'x-agent-run-id' ? 'run_123:retry-2' : undefined } } as any
    expect(resolveAgentAttribution(c, session)).toEqual({
      actorType: 'agent',
      agentId: 'qa-agent',
      credentialId: 'credential-7',
      runId: 'run_123:retry-2',
    })
  })

  it('rejects missing and unsafe run IDs', () => {
    expect(() => resolveAgentAttribution({ req: { header: () => undefined } } as any, session))
      .toThrow('X-Agent-Run-ID is required')
    expect(() => resolveAgentAttribution({ req: { header: () => 'run id with spaces' } } as any, session))
      .toThrow('must be 1-128 safe characters')
  })
})

function registry(token: string, name: string) {
  return createApiKeyRegistry([{ token, credential: {
    name, agentId: name, credentialId: name, displayName: name, scopes: [],
  } }])
}

describe('normalizeCsrfToken', () => {
  it('returns undefined for empty/null values', () => {
    expect(normalizeCsrfToken(undefined)).toBeUndefined()
    expect(normalizeCsrfToken('')).toBeUndefined()
    expect(normalizeCsrfToken('  ')).toBeUndefined()
  })

  it('trims whitespace', () => {
    expect(normalizeCsrfToken('  abc  ')).toBe('abc')
  })

  it('strips surrounding double quotes', () => {
    expect(normalizeCsrfToken('"my-token"')).toBe('my-token')
  })

  it('strips surrounding single quotes', () => {
    expect(normalizeCsrfToken("'my-token'")).toBe('my-token')
  })

  it('returns plain values as-is', () => {
    expect(normalizeCsrfToken('my-token')).toBe('my-token')
  })
})
