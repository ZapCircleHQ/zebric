/**
 * Real Better Auth on a real (Miniflare) D1 database, using the same auth
 * migration the Cloudflare starter and workers-blog example ship. Guards both
 * Better Auth upgrades and drift between the shipped SQL and what the library expects.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import { getMigrations } from 'better-auth/db/migration'
import { WorkersBetterAuthProvider } from '../../src/auth/better-auth-provider.js'

const BASE_URL = 'https://app.example.com'
const SECRET = 'test-secret-test-secret-test-secret-0123456789'
// https base URL => secure cookies => __Secure- prefix
const COOKIE_NAME = '__Secure-better-auth.session_token'

const authSql = (rel: string) =>
  readFileSync(new URL(`../../../../${rel}/migrations/0000_auth.sql`, import.meta.url), 'utf8')

async function applySql(db: D1Database, sql: string) {
  const statements = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const s of statements) await db.prepare(s).run()
}

describe('WorkersBetterAuthProvider on D1', () => {
  let mf: Miniflare
  let db: D1Database
  let provider: WorkersBetterAuthProvider
  let auth: ReturnType<WorkersBetterAuthProvider['getAuthInstance']>

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    auth.handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL, ...headers },
        body: JSON.stringify(body),
      })
    )

  const cookieFrom = (res: Response): string => {
    const c = res.headers.getSetCookie().find((h) => h.startsWith(`${COOKIE_NAME}=`))
    if (!c) throw new Error(`no session cookie; status=${res.status}`)
    return c.split(';')[0]
  }

  const signUp = (email: string, extra: Record<string, unknown> = {}) =>
    post('/sign-up/email', { email, password: 'correct-horse-battery', name: 'Test', ...extra })

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-04-28',
      d1Databases: { DB: 'd1:auth-test' },
    })
    db = await mf.getD1Database('DB')
    await applySql(db, authSql('starters/cloudflare-workers'))

    provider = new WorkersBetterAuthProvider({
      database: db,
      blueprint: { auth: { providers: ['email'] } } as any,
      baseURL: BASE_URL,
      secret: SECRET,
    })
    auth = provider.getAuthInstance()
  })

  afterAll(async () => {
    await mf?.dispose()
  })

  it('signs up and resolves the session from the cookie', async () => {
    const res = await signUp('d1-cookie@example.com')
    expect(res.status).toBe(200)
    const session = await provider.getSession(
      new Request(`${BASE_URL}/`, { headers: { cookie: cookieFrom(res) } })
    )
    expect(session?.user.email).toBe('d1-cookie@example.com')
    expect(session?.user.role).toBe('user')
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('resolves the session from a Bearer token carrying the signed cookie value', async () => {
    const cookie = cookieFrom(await signUp('d1-bearer@example.com'))
    const token = decodeURIComponent(cookie.slice(`${COOKIE_NAME}=`.length))
    const session = await provider.getSession(
      new Request(`${BASE_URL}/`, { headers: { authorization: `Bearer ${token}` } })
    )
    expect(session?.user.email).toBe('d1-bearer@example.com')
  })

  it('accepts HttpRequest-style header objects', async () => {
    const cookie = cookieFrom(await signUp('d1-http@example.com'))
    const session = await provider.getSession({ headers: { cookie } } as any)
    expect(session?.user.email).toBe('d1-http@example.com')
  })

  it('signs in, and rejects a wrong password', async () => {
    await signUp('d1-login@example.com')
    const ok = await post('/sign-in/email', { email: 'd1-login@example.com', password: 'correct-horse-battery' })
    expect(ok.status).toBe(200)
    expect(await provider.getSession({ headers: { cookie: cookieFrom(ok) } } as any)).not.toBeNull()

    const bad = await post('/sign-in/email', { email: 'd1-login@example.com', password: 'nope-nope-nope' })
    expect(bad.status).toBeGreaterThanOrEqual(400)
  })

  it('returns null for missing, garbage and tampered credentials', async () => {
    expect(await provider.getSession(new Request(`${BASE_URL}/`))).toBeNull()
    expect(
      await provider.getSession(new Request(`${BASE_URL}/`, { headers: { cookie: `${COOKIE_NAME}=garbage` } }))
    ).toBeNull()
    expect(
      await provider.getSession(new Request(`${BASE_URL}/`, { headers: { authorization: 'Bearer garbage' } }))
    ).toBeNull()

    const cookie = cookieFrom(await signUp('d1-tamper@example.com'))
    const tampered = cookie.slice(0, -4) + 'AAAA'
    expect(await provider.getSession({ headers: { cookie: tampered } } as any)).toBeNull()
  })

  it('invalidates the session on sign-out', async () => {
    const cookie = cookieFrom(await signUp('d1-signout@example.com'))
    expect(await provider.getSession({ headers: { cookie } } as any)).not.toBeNull()
    expect((await post('/sign-out', {}, { cookie })).status).toBe(200)
    expect(await provider.getSession({ headers: { cookie } } as any)).toBeNull()
  })

  it('ignores a client-supplied role at sign-up and on self-update', async () => {
    const cookie = cookieFrom(await signUp('d1-role@example.com', { role: 'admin' }))
    await post('/update-user', { role: 'admin' }, { cookie })
    const session = await provider.getSession({ headers: { cookie } } as any)
    expect(session?.user.role).toBe('user')
    expect(provider.hasRole(session, 'admin')).toBe(false)
  })

  it('persists users, sessions and credential accounts in the shipped schema', async () => {
    await signUp('d1-schema@example.com')
    const user = await db.prepare('select id, role, emailVerified from "user" where email = ?').bind('d1-schema@example.com').first<any>()
    expect(user).toBeTruthy()
    expect(user.role).toBe('user')
    const account = await db.prepare('select providerId, password from "account" where userId = ?').bind(user.id).first<any>()
    expect(account.providerId).toBe('credential')
    // Passwords must be hashed, never stored in the clear
    expect(account.password).toBeTruthy()
    expect(account.password).not.toContain('correct-horse-battery')
  })

  it('shipped 0000_auth.sql matches the schema Better Auth expects (no drift)', async () => {
    const { toBeCreated, toBeAdded } = await getMigrations(auth.options)
    expect(toBeCreated.map((t) => t.table)).toEqual([])
    expect(toBeAdded.map((t) => t.table)).toEqual([])
  })

  it('ships identical auth migrations in the starter and the workers-blog example', () => {
    expect(authSql('examples/workers-blog')).toBe(authSql('starters/cloudflare-workers'))
  })

  it('does not expose plugin endpoints Zebric does not enable', async () => {
    for (const path of ['/oauth2/token', '/sign-in/magic-link', '/email-otp/send-verification-otp', '/device/approve']) {
      expect((await post(path, {})).status, path).toBe(404)
    }
  })
})
