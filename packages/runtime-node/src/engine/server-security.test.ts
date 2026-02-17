import { describe, it, expect, vi } from 'vitest'
import {
  initApiKeys,
  resolveApiKeySession,
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
    expect(apiKeys.get('secret-key-123')).toEqual({ name: 'test-agent' })

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
    const apiKeys = new Map([['secret-key-123', { name: 'test-agent' }]])

    const session = resolveApiKeySession('secret-key-123', apiKeys)
    expect(session).not.toBeNull()
    expect(session.user.id).toBe('test-agent')
    expect(session.user.name).toBe('test-agent')
    expect(session.userId).toBe('test-agent')
  })

  it('returns null for an unknown token', () => {
    const apiKeys = new Map([['secret-key-123', { name: 'test-agent' }]])

    const session = resolveApiKeySession('wrong-key', apiKeys)
    expect(session).toBeNull()
  })
})

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
