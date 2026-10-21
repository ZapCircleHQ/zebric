/**
 * Integration tests against the real Better Auth library (no mocks).
 * They guard dependency upgrades: sign-up/sign-in, session lookup, tampering,
 * sign-out and the server-controlled `role` field must keep working.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getMigrations } from 'better-auth/db/migration'
import { BetterAuthProvider } from './better-auth-provider.js'

const BASE_URL = 'http://localhost:3000'
const SECRET = 'test-secret-test-secret-test-secret-0123456789'
const COOKIE_NAME = 'better-auth.session_token'

describe('BetterAuthProvider (real Better Auth)', () => {
  let dir: string
  let provider: BetterAuthProvider
  let auth: ReturnType<BetterAuthProvider['getAuthInstance']>

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL, ...headers },
        body: JSON.stringify(body),
      })
    )

  const sessionCookie = (res: Response): string => {
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`))
    if (!setCookie) throw new Error('no session cookie in response')
    return setCookie.split(';')[0]
  }

  const signUp = async (email: string, extra: Record<string, unknown> = {}) => {
    const res = await post('/sign-up/email', {
      email,
      password: 'correct-horse-battery',
      name: 'Test User',
      ...extra,
    })
    return res
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'zebric-auth-'))
    provider = new BetterAuthProvider({
      databaseUrl: join(dir, 'auth.db'),
      blueprint: { auth: { providers: ['email'] } } as any,
      baseURL: BASE_URL,
      secret: SECRET,
      trustedOrigins: [BASE_URL],
    })
    auth = provider.getAuthInstance()
    const { runMigrations } = await getMigrations(auth.options)
    await runMigrations()
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('signs a user up and resolves the session from the cookie', async () => {
    const res = await signUp('cookie@example.com')
    expect(res.status).toBe(200)
    const cookie = sessionCookie(res)

    const session = await provider.getSession(
      new Request(`${BASE_URL}/`, { headers: { cookie } })
    )
    expect(session).not.toBeNull()
    expect(session!.user.email).toBe('cookie@example.com')
    expect(session!.userId).toBe(session!.user.id)
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('resolves the session for plain Node-style requests with header objects', async () => {
    const cookie = sessionCookie(await signUp('node-req@example.com'))
    const session = await provider.getSession({ headers: { cookie } })
    expect(session?.user.email).toBe('node-req@example.com')
  })

  it('resolves the session from a Bearer token carrying the signed cookie value', async () => {
    const cookie = sessionCookie(await signUp('bearer@example.com'))
    const token = cookie.slice(`${COOKIE_NAME}=`.length)
    const session = await provider.getSession(
      new Request(`${BASE_URL}/`, { headers: { authorization: `Bearer ${decodeURIComponent(token)}` } })
    )
    expect(session?.user.email).toBe('bearer@example.com')
  })

  it('signs in with email/password and rejects a wrong password', async () => {
    await signUp('login@example.com')

    const ok = await post('/sign-in/email', {
      email: 'login@example.com',
      password: 'correct-horse-battery',
    })
    expect(ok.status).toBe(200)
    const session = await provider.getSession(
      new Request(`${BASE_URL}/`, { headers: { cookie: sessionCookie(ok) } })
    )
    expect(session?.user.email).toBe('login@example.com')

    const bad = await post('/sign-in/email', { email: 'login@example.com', password: 'wrong-password-1' })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    expect(bad.headers.getSetCookie().some((c) => c.startsWith(`${COOKIE_NAME}=`) && !/max-age=0/i.test(c))).toBe(false)
  })

  it('rejects duplicate sign-up for the same email', async () => {
    await signUp('dupe@example.com')
    const res = await signUp('dupe@example.com')
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('returns null without credentials, and for garbage or tampered tokens', async () => {
    expect(await provider.getSession(new Request(`${BASE_URL}/`))).toBeNull()
    expect(
      await provider.getSession(new Request(`${BASE_URL}/`, { headers: { cookie: `${COOKIE_NAME}=garbage` } }))
    ).toBeNull()

    const cookie = sessionCookie(await signUp('tamper@example.com'))
    const tampered = cookie.slice(0, -4) + 'AAAA'
    expect(
      await provider.getSession(new Request(`${BASE_URL}/`, { headers: { cookie: tampered } }))
    ).toBeNull()
  })

  it('rejects a cookie signed with a different secret', async () => {
    const other = new BetterAuthProvider({
      databaseUrl: join(dir, 'other.db'),
      blueprint: { auth: { providers: ['email'] } } as any,
      baseURL: BASE_URL,
      secret: 'a-completely-different-secret-0123456789ab',
      trustedOrigins: [BASE_URL],
    })
    const otherAuth = other.getAuthInstance()
    const { runMigrations } = await getMigrations(otherAuth.options)
    await runMigrations()

    const cookie = sessionCookie(await signUp('cross@example.com'))
    expect(await other.getSession({ headers: { cookie } })).toBeNull()
  })

  it('invalidates the session on sign-out', async () => {
    const cookie = sessionCookie(await signUp('signout@example.com'))
    expect(await provider.getSession({ headers: { cookie } })).not.toBeNull()

    const out = await post('/sign-out', {}, { cookie })
    expect(out.status).toBe(200)
    expect(await provider.getSession({ headers: { cookie } })).toBeNull()
  })

  it('defaults role to "user" and ignores a client-supplied role', async () => {
    const res = await signUp('role@example.com', { role: 'admin' })
    const cookie = sessionCookie(res)
    const session = await provider.getSession({ headers: { cookie } })
    expect(session?.user.role).toBe('user')
    expect(provider.hasRole(session, 'admin')).toBe(false)
    expect(provider.hasRole(session, 'user')).toBe(true)
  })

  it('does not let a user update their own role', async () => {
    const cookie = sessionCookie(await signUp('selfpromote@example.com'))
    await post('/update-user', { role: 'admin', name: 'Renamed' }, { cookie })
    const session = await provider.getSession({ headers: { cookie } })
    expect(session?.user.role).toBe('user')
  })

  it('does not expose plugin endpoints Zebric does not enable', async () => {
    for (const path of [
      '/oauth2/token',
      '/oauth2/authorize',
      '/sign-in/magic-link',
      '/email-otp/send-verification-otp',
      '/device/approve',
      '/organization/accept-invitation',
    ]) {
      const res = await post(path, {})
      expect(res.status, path).toBe(404)
    }
  })

  it('only unauthenticated sessions are rejected by ownership/role helpers', () => {
    expect(provider.hasRole(null, 'user')).toBe(false)
    expect(provider.ownsResource(null, 'x')).toBe(false)
  })

  it('creates the schema Zebric expects (user/session/account/verification + role)', async () => {
    const { toBeCreated, toBeAdded } = await getMigrations(auth.options)
    expect(toBeCreated).toEqual([])
    expect(toBeAdded).toEqual([])
  })
})
