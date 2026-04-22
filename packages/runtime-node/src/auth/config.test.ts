import { describe, it, expect, vi } from 'vitest'

vi.mock('better-sqlite3', () => ({
  default: vi.fn(class {
    close = vi.fn()
  }),
}))

vi.mock('better-auth', () => ({
  betterAuth: vi.fn().mockReturnValue({ handler: vi.fn(), api: {} }),
}))

vi.mock('./better-auth-provider.js', () => ({
  BetterAuthProvider: vi.fn(class {
    _config: any
    getAuthInstance = vi.fn()
    getSession = vi.fn()
    cleanup = vi.fn()

    constructor(config: any) {
      this._config = config
    }
  }),
}))

import { betterAuth } from 'better-auth'
import Database from 'better-sqlite3'
import { getAuthConfigFromBlueprint, createBetterAuthProvider, createAuth } from './config.js'

const mockBetterAuth = betterAuth as ReturnType<typeof vi.fn>
const MockDatabase = Database as unknown as ReturnType<typeof vi.fn>

function minimalBlueprint(overrides: Record<string, any> = {}): any {
  return {
    version: '1.0',
    project: { name: 'Test', version: '0.1.0', runtime: { min_version: '0.1.0' } },
    entities: [],
    pages: [],
    ...overrides,
  }
}

describe('getAuthConfigFromBlueprint', () => {
  it('returns providers from blueprint.auth.providers', () => {
    const bp = minimalBlueprint({ auth: { providers: ['email', 'google'] } })
    const result = getAuthConfigFromBlueprint(bp)
    expect(result.providers).toEqual(['email', 'google'])
  })

  it('defaults to ["email"] when blueprint has no auth section', () => {
    const bp = minimalBlueprint()
    const result = getAuthConfigFromBlueprint(bp)
    expect(result.providers).toEqual(['email'])
  })

  it('defaults to ["email"] when blueprint.auth has no providers', () => {
    const bp = minimalBlueprint({ auth: {} })
    const result = getAuthConfigFromBlueprint(bp)
    expect(result.providers).toEqual(['email'])
  })
})

describe('createBetterAuthProvider', () => {
  it('returns an AuthProvider instance', () => {
    const config = {
      databaseUrl: ':memory:',
      blueprint: minimalBlueprint({ auth: { providers: ['email'] } }),
      baseURL: 'http://localhost:3000',
      secret: 'test-secret',
      trustedOrigins: ['http://localhost:3000'],
    }
    const provider = createBetterAuthProvider(config)
    expect(provider).toBeDefined()
    expect(typeof provider.getSession).toBe('function')
  })
})

describe('createAuth', () => {
  it('creates a better-auth instance with email/password enabled for email provider', () => {
    vi.clearAllMocks()
    const config = {
      databaseUrl: ':memory:',
      blueprint: minimalBlueprint({ auth: { providers: ['email'] } }),
      baseURL: 'http://localhost:3000',
      secret: 'test-secret',
      trustedOrigins: ['http://localhost:3000'],
    }

    createAuth(config)

    expect(MockDatabase).toHaveBeenCalledWith(':memory:')
    expect(mockBetterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://localhost:3000',
        secret: 'test-secret',
        trustedOrigins: ['http://localhost:3000'],
        emailAndPassword: { enabled: true },
      })
    )
  })

  it('disables email/password when email provider is not in list', () => {
    vi.clearAllMocks()
    const config = {
      databaseUrl: ':memory:',
      blueprint: minimalBlueprint({ auth: { providers: ['google'] } }),
      baseURL: 'http://localhost:3000',
      secret: 'secret',
      trustedOrigins: [],
    }

    createAuth(config)

    expect(mockBetterAuth).toHaveBeenCalledWith(
      expect.objectContaining({ emailAndPassword: undefined })
    )
  })

  it('sets useSecureCookies based on NODE_ENV', () => {
    vi.clearAllMocks()
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    createAuth({
      databaseUrl: ':memory:',
      blueprint: minimalBlueprint(),
      baseURL: 'https://example.com',
      secret: 'secret',
      trustedOrigins: [],
    })

    expect(mockBetterAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        advanced: { useSecureCookies: true },
      })
    )
    process.env.NODE_ENV = original
  })
})
