import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleWorkspaceAuthProvider } from './google-workspace-provider.js'

function makeProvider(overrides: Record<string, any> = {}) {
  return new GoogleWorkspaceAuthProvider({
    databaseUrl: ':memory:',
    blueprint: {
      version: '1.0',
      project: { name: 'Test', version: '0.1.0', runtime: { min_version: '0.1.0' } },
      entities: [],
      pages: [],
      auth: {
        provider: 'google-workspace',
        google: {},
        ...overrides.auth,
      },
    } as any,
    baseURL: 'http://localhost:3000',
    secret: 'test-secret',
    trustedOrigins: ['http://localhost:3000'],
  })
}

const providers: GoogleWorkspaceAuthProvider[] = []

function track(provider: GoogleWorkspaceAuthProvider) {
  providers.push(provider)
  return provider
}

afterEach(async () => {
  while (providers.length > 0) {
    const provider = providers.pop()!
    await provider.cleanup()
  }
})

describe('GoogleWorkspaceAuthProvider normalizeCallbackUrl', () => {
  it('allows root-relative paths', () => {
    const provider = track(makeProvider())
    expect((provider as any).normalizeCallbackUrl('/dashboard')).toBe('/dashboard')
    expect((provider as any).normalizeCallbackUrl('/')).toBe('/')
  })

  it('allows absolute URLs on trusted origins', () => {
    const provider = track(makeProvider())
    expect((provider as any).normalizeCallbackUrl('http://localhost:3000/dashboard')).toBe('http://localhost:3000/dashboard')
  })

  it('rejects protocol-relative URLs to prevent open redirect', () => {
    const provider = track(makeProvider())
    expect((provider as any).normalizeCallbackUrl('//evil.com')).toBe('/')
    expect((provider as any).normalizeCallbackUrl('//evil.com/steal')).toBe('/')
  })

  it('rejects absolute URLs on untrusted origins', () => {
    const provider = track(makeProvider())
    expect((provider as any).normalizeCallbackUrl('https://evil.com/phish')).toBe('/')
  })

  it('returns / for null or empty input', () => {
    const provider = track(makeProvider())
    expect((provider as any).normalizeCallbackUrl(null)).toBe('/')
    expect((provider as any).normalizeCallbackUrl('')).toBe('/')
  })
})

describe('GoogleWorkspaceAuthProvider validateGoogleUser', () => {
  it('accepts a valid user with no hostedDomain configured', () => {
    const provider = track(makeProvider())
    expect((provider as any).validateGoogleUser({ email: 'user@any.com' })).toBeNull()
  })

  it('rejects a user with no email', () => {
    const provider = track(makeProvider())
    expect((provider as any).validateGoogleUser({ email: '' })).toBeTruthy()
    expect((provider as any).validateGoogleUser({})).toBeTruthy()
  })

  it('rejects a user with explicitly unverified email', () => {
    const provider = track(makeProvider())
    expect((provider as any).validateGoogleUser({ email: 'user@example.com', email_verified: false })).toBeTruthy()
  })

  it('accepts a user when email_verified is not present (not explicitly false)', () => {
    const provider = track(makeProvider())
    expect((provider as any).validateGoogleUser({ email: 'user@example.com' })).toBeNull()
  })

  it('accepts a user whose email domain matches hostedDomain', () => {
    const provider = track(makeProvider({ auth: { google: { hostedDomain: 'acme.com' } } }))
    expect((provider as any).validateGoogleUser({ email: 'alice@acme.com' })).toBeNull()
  })

  it('accepts a user whose hd claim matches hostedDomain even if email domain differs', () => {
    const provider = track(makeProvider({ auth: { google: { hostedDomain: 'acme.com' } } }))
    expect((provider as any).validateGoogleUser({ email: 'alias@other.com', hd: 'acme.com' })).toBeNull()
  })

  it('rejects a user whose email domain and hd claim both differ from hostedDomain', () => {
    const provider = track(makeProvider({ auth: { google: { hostedDomain: 'acme.com' } } }))
    const error = (provider as any).validateGoogleUser({ email: 'attacker@evil.com', hd: 'evil.com' })
    expect(error).toBeTruthy()
    expect(error).toContain('acme.com')
  })

  it('is case-insensitive when comparing email domain to hostedDomain', () => {
    const provider = track(makeProvider({ auth: { google: { hostedDomain: 'Acme.COM' } } }))
    expect((provider as any).validateGoogleUser({ email: 'Alice@ACME.com' })).toBeNull()
  })
})

describe('GoogleWorkspaceAuthProvider extractToken', () => {
  function makeRequest(headers: Record<string, string>) {
    return new Request('http://localhost:3000/api/auth/session', { headers })
  }

  it('extracts Bearer token from Authorization header', () => {
    const provider = track(makeProvider())
    const req = makeRequest({ authorization: 'Bearer mytoken123' })
    expect((provider as any).extractToken(req)).toBe('mytoken123')
  })

  it('is case-insensitive for Bearer scheme', () => {
    const provider = track(makeProvider())
    const req = makeRequest({ authorization: 'BEARER mytoken123' })
    expect((provider as any).extractToken(req)).toBe('mytoken123')
  })

  it('extracts token from zbl-token header', () => {
    const provider = track(makeProvider())
    const req = makeRequest({ 'zbl-token': 'headertoken' })
    expect((provider as any).extractToken(req)).toBe('headertoken')
  })

  it('extracts token from x-api-token header', () => {
    const provider = track(makeProvider())
    const req = makeRequest({ 'x-api-token': 'apikeytoken' })
    expect((provider as any).extractToken(req)).toBe('apikeytoken')
  })

  it('extracts session token from cookie', () => {
    const provider = track(makeProvider())
    const req = makeRequest({ cookie: 'zebric.session_token=cookietoken123' })
    expect((provider as any).extractToken(req)).toBe('cookietoken123')
  })

  it('returns null when no token is present', () => {
    const provider = track(makeProvider())
    const req = makeRequest({})
    expect((provider as any).extractToken(req)).toBeNull()
  })
})

describe('GoogleWorkspaceAuthProvider session lifecycle', () => {
  it('createSession returns a token that resolveUserFromToken can look up', async () => {
    const provider = track(makeProvider())
    const profile = (provider as any).buildProfileFromGoogleUser({ email: 'bob@example.com', name: 'Bob' })
    ;(provider as any).upsertUserProfile(profile)

    const tokenRecord = await provider.createSession('bob@example.com')
    expect(tokenRecord.token).toBeTruthy()

    const user = await provider.resolveUserFromToken(tokenRecord.token)
    expect(user).toMatchObject({ email: 'bob@example.com', name: 'Bob' })
  })

  it('invalidateSession makes the token unresolvable', async () => {
    const provider = track(makeProvider())
    const profile = (provider as any).buildProfileFromGoogleUser({ email: 'bob@example.com', name: 'Bob' })
    ;(provider as any).upsertUserProfile(profile)

    const tokenRecord = await provider.createSession('bob@example.com')
    await provider.invalidateSession(tokenRecord.token)

    expect(await provider.resolveUserFromToken(tokenRecord.token)).toBeNull()
  })

  it('resolveUserFromToken returns null for an expired session', async () => {
    const provider = track(makeProvider())
    const profile = (provider as any).buildProfileFromGoogleUser({ email: 'carol@example.com', name: 'Carol' })
    ;(provider as any).upsertUserProfile(profile)

    const tokenRecord = await provider.createSession('carol@example.com')

    // Expire the session directly in the DB
    ;(provider as any).db
      .prepare('UPDATE zebric_google_session SET expires_at = ? WHERE token = ?')
      .run(Date.now() - 1000, tokenRecord.token)

    expect(await provider.resolveUserFromToken(tokenRecord.token)).toBeNull()
  })

  it('getSession returns null when no token in request', async () => {
    const provider = track(makeProvider())
    const req = new Request('http://localhost:3000/api/auth/session')
    expect(await provider.getSession(req)).toBeNull()
  })

  it('getSession returns a full UserSession for a valid cookie token', async () => {
    const provider = track(makeProvider({ auth: { google: { defaultRole: 'member' } } }))
    const profile = (provider as any).buildProfileFromGoogleUser({ email: 'dave@example.com', name: 'Dave' })
    ;(provider as any).upsertUserProfile(profile)

    const tokenRecord = await provider.createSession('dave@example.com')
    const req = new Request('http://localhost:3000/api/auth/session', {
      headers: { cookie: `zebric.session_token=${tokenRecord.token}` },
    })

    const session = await provider.getSession(req)
    expect(session).not.toBeNull()
    expect(session!.user.email).toBe('dave@example.com')
    expect(session!.user.name).toBe('Dave')
    expect(session!.user.role).toBe('member')
  })

  it('getSession returns null and cleans up an expired session', async () => {
    const provider = track(makeProvider())
    const profile = (provider as any).buildProfileFromGoogleUser({ email: 'eve@example.com', name: 'Eve' })
    ;(provider as any).upsertUserProfile(profile)

    const tokenRecord = await provider.createSession('eve@example.com')
    ;(provider as any).db
      .prepare('UPDATE zebric_google_session SET expires_at = ? WHERE token = ?')
      .run(Date.now() - 1000, tokenRecord.token)

    const req = new Request('http://localhost:3000/api/auth/session', {
      headers: { cookie: `zebric.session_token=${tokenRecord.token}` },
    })

    expect(await provider.getSession(req)).toBeNull()
    // Confirm the row was deleted
    const row = (provider as any).db
      .prepare('SELECT * FROM zebric_google_session WHERE token = ?')
      .get(tokenRecord.token)
    expect(row).toBeUndefined()
  })
})

describe('GoogleWorkspaceAuthProvider hasRole / ownsResource', () => {
  async function makeSession(provider: GoogleWorkspaceAuthProvider, email: string, roles: string[]) {
    const profile = { userId: email, email, name: null, role: roles[0], roles, groups: [] }
    ;(provider as any).upsertUserProfile(profile)
    const tokenRecord = await provider.createSession(email)
    const req = new Request('http://localhost:3000/', {
      headers: { cookie: `zebric.session_token=${tokenRecord.token}` },
    })
    return provider.getSession(req)
  }

  it('hasRole returns false for null session', () => {
    const provider = track(makeProvider())
    expect(provider.hasRole(null, 'admin')).toBe(false)
  })

  it('hasRole returns true when role is in roles array', async () => {
    const provider = track(makeProvider())
    const session = await makeSession(provider, 'frank@example.com', ['editor', 'viewer'])
    expect(provider.hasRole(session, 'editor')).toBe(true)
    expect(provider.hasRole(session, 'viewer')).toBe(true)
    expect(provider.hasRole(session, 'admin')).toBe(false)
  })

  it('ownsResource returns false for null session', () => {
    const provider = track(makeProvider())
    expect(provider.ownsResource(null, 'some-user-id')).toBe(false)
  })

  it('ownsResource returns true when userId matches', async () => {
    const provider = track(makeProvider())
    const session = await makeSession(provider, 'grace@example.com', ['user'])
    expect(provider.ownsResource(session, 'grace@example.com')).toBe(true)
    expect(provider.ownsResource(session, 'other@example.com')).toBe(false)
  })
})

describe('GoogleWorkspaceAuthProvider OAuth flow', () => {
  beforeEach(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('beginSignIn redirects to Google with state cookie when credentials are configured', async () => {
    const provider = track(makeProvider())
    const req = new Request('http://localhost:3000/api/auth/sign-in/google?callbackURL=/dashboard')
    const res = await provider.handleAuthRequest(req)

    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('accounts.google.com')
    expect(location).toContain('client_id=test-client-id')
    expect(location).toContain('state=')

    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('zebric.oauth_state=')
    expect(cookie).toContain('HttpOnly')
  })

  it('beginSignIn appends hd param when hostedDomain is configured', async () => {
    const provider = track(makeProvider({ auth: { google: { hostedDomain: 'acme.com' } } }))
    const req = new Request('http://localhost:3000/api/auth/sign-in/google')
    const res = await provider.handleAuthRequest(req)

    const location = res.headers.get('location') ?? ''
    expect(location).toContain('hd=acme.com')
  })

  it('beginSignIn returns 500 when client credentials are not set', async () => {
    vi.unstubAllEnvs()
    const provider = track(makeProvider())
    const req = new Request('http://localhost:3000/api/auth/sign-in/google')
    const res = await provider.handleAuthRequest(req)
    expect(res.status).toBe(500)
  })

  it('finishSignIn redirects to sign-in on state mismatch', async () => {
    const provider = track(makeProvider())
    const req = new Request(
      'http://localhost:3000/api/auth/callback/google?state=wrong&code=authcode',
      { headers: { cookie: 'zebric.oauth_state=different' } }
    )
    const res = await provider.handleAuthRequest(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/auth/sign-in')
  })

  it('finishSignIn redirects to sign-in when state is expired', async () => {
    const provider = track(makeProvider())
    const state = 'expiredstate123'
    ;(provider as any).db
      .prepare('INSERT INTO zebric_google_oauth_state (state, callback_url, expires_at) VALUES (?, ?, ?)')
      .run(state, '/dashboard', Date.now() - 1000)

    const req = new Request(
      `http://localhost:3000/api/auth/callback/google?state=${state}&code=authcode`,
      { headers: { cookie: `zebric.oauth_state=${state}` } }
    )
    const res = await provider.handleAuthRequest(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/auth/sign-in')
  })

  it('finishSignIn completes sign-in and sets session cookie', async () => {
    const provider = track(makeProvider())
    const state = 'validstate456'
    ;(provider as any).db
      .prepare('INSERT INTO zebric_google_oauth_state (state, callback_url, expires_at) VALUES (?, ?, ?)')
      .run(state, '/dashboard', Date.now() + 60_000)

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'goog-access-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: '12345',
        email: 'alice@example.com',
        email_verified: true,
        name: 'Alice',
      }), { status: 200 }))
    )

    const req = new Request(
      `http://localhost:3000/api/auth/callback/google?state=${state}&code=authcode`,
      { headers: { cookie: `zebric.oauth_state=${state}` } }
    )
    const res = await provider.handleAuthRequest(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/dashboard')

    const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
    const sessionCookie = cookies.find(c => c.startsWith('zebric.session_token='))
    expect(sessionCookie).toBeTruthy()
    expect(sessionCookie).toContain('HttpOnly')
  })

  it('finishSignIn rejects a user from the wrong domain when hostedDomain is set', async () => {
    const provider = track(makeProvider({ auth: { google: { hostedDomain: 'acme.com' } } }))
    const state = 'domainstate789'
    ;(provider as any).db
      .prepare('INSERT INTO zebric_google_oauth_state (state, callback_url, expires_at) VALUES (?, ?, ?)')
      .run(state, '/dashboard', Date.now() + 60_000)

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'goog-access-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sub: '99999',
        email: 'attacker@evil.com',
        email_verified: true,
        name: 'Attacker',
        hd: 'evil.com',
      }), { status: 200 }))
    )

    const req = new Request(
      `http://localhost:3000/api/auth/callback/google?state=${state}&code=authcode`,
      { headers: { cookie: `zebric.oauth_state=${state}` } }
    )
    const res = await provider.handleAuthRequest(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/auth/sign-in')
  })

  it('signOut clears the session cookie and invalidates the token', async () => {
    const provider = track(makeProvider())
    const profile = (provider as any).buildProfileFromGoogleUser({ email: 'henry@example.com', name: 'Henry' })
    ;(provider as any).upsertUserProfile(profile)
    const tokenRecord = await provider.createSession('henry@example.com')

    const req = new Request('http://localhost:3000/api/auth/sign-out?callbackURL=/login', {
      headers: { cookie: `zebric.session_token=${tokenRecord.token}` },
    })
    const res = await provider.handleAuthRequest(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')

    const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
    const clearedCookie = cookies.find(c => c.startsWith('zebric.session_token='))
    expect(clearedCookie).toContain('Max-Age=0')

    expect(await provider.resolveUserFromToken(tokenRecord.token)).toBeNull()
  })
})

describe('GoogleWorkspaceAuthProvider claim mapping', () => {
  it('maps roles and groups from configured claim rules', () => {
    const provider = track(makeProvider({
      auth: {
        google: {
          defaultRole: 'employee',
          defaultGroups: ['workspace'],
          roleMappings: [
            {
              value: 'admin',
              when: [{ claim: 'email', endsWith: '@admin.example.com' }],
            },
            {
              value: 'finance',
              mode: 'any',
              when: [
                { claim: 'hd', equals: 'example.com' },
                { claim: 'department', equals: 'finance' },
              ],
            },
          ],
          groupMappings: [
            {
              value: 'ops',
              when: [{ claim: 'email', contains: '+ops@' }],
            },
            {
              value: 'leadership',
              when: [{ claim: 'org.units', oneOf: ['exec', 'staff'] }],
            },
          ],
        },
      },
    }))

    const profile = (provider as any).buildProfileFromGoogleUser({
      email: 'alex+ops@admin.example.com',
      name: 'Alex',
      hd: 'example.com',
      department: 'finance',
      org: { units: ['staff'] },
    })

    expect(profile.role).toBe('admin')
    expect(profile.roles).toEqual(['admin', 'finance'])
    expect(profile.groups).toEqual(['workspace', 'ops', 'leadership'])
  })

  it('persists mapped roles and groups into plugin-created sessions', async () => {
    const provider = track(makeProvider({
      auth: {
        google: {
          defaultRole: 'employee',
          defaultGroups: ['workspace'],
        },
      },
    }))

    const profile = (provider as any).buildProfileFromGoogleUser({
      email: 'sam@example.com',
      name: 'Sam',
      hd: 'example.com',
    })
    ;(provider as any).upsertUserProfile(profile)

    const token = await provider.createSession('sam@example.com')
    const user = await provider.resolveUserFromToken(token.token)

    expect(user).toMatchObject({
      email: 'sam@example.com',
      role: 'employee',
      roles: ['employee'],
      groups: ['workspace'],
    })
  })
})
