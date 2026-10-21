/**
 * Better Auth running inside workerd (through the real Workers engine) on D1:
 * sign-up, session lookup, sign-in and sign-out, plus a bounded wait on get-session.
 *
 * Note: this does NOT reproduce the Better Auth 1.7.6+ hang fixed by
 * `validateSchema: false` in WorkersBetterAuthProvider. That hang only shows up under
 * `wrangler dev`, and is caught by `pnpm test:workers-apps`.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'

const ORIGIN = 'https://app.example'
const COOKIE = '__Secure-better-auth.session_token'

describe('Better Auth inside workerd', () => {
  let mf: Miniflare
  let output: string

  // dispatchFetch ignores AbortSignal, so race it: a hung worker must fail the test quickly.
  const fetchWithin = (path: string, init: RequestInit = {}, ms = 8_000) =>
    Promise.race([
      mf.dispatchFetch(`${ORIGIN}${path}`, init as any),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`workerd request to ${path} hung for ${ms}ms`)), ms).unref()),
    ])

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetchWithin(`/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'x-csrf-token': 'csrf-test',
        ...headers,
        cookie: ['csrf-token=csrf-test', headers.cookie].filter(Boolean).join('; '),
      },
      body: JSON.stringify(body),
    })

  beforeAll(async () => {
    output = await mkdtemp(join(tmpdir(), 'zebric-auth-workerd-'))
    await promisify(execFile)(
      process.execPath,
      [
        new URL(import.meta.resolve('wrangler')).pathname, 'deploy', 'tests/fixtures/auth-worker.ts',
        '--dry-run', '--outdir', output, '--name', 'zebric-auth-test',
        '--compatibility-date', '2026-04-28', '--compatibility-flags', 'nodejs_compat',
      ],
      { cwd: new URL('../..', import.meta.url).pathname, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
    )
    mf = new Miniflare({
      modulesRoot: output,
      modules: [{ type: 'ESModule', path: join(output, 'auth-worker.js') }],
      compatibilityDate: '2026-04-28',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'auth' },
      bindings: { BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789' },
    })
    const db = await mf.getD1Database('DB')
    const sql = await readFile(
      new URL('../../../../starters/cloudflare-workers/migrations/0000_auth.sql', import.meta.url),
      'utf8',
    )
    const statements = sql
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      .split(';').map((s) => s.trim()).filter(Boolean)
    for (const s of statements) await db.prepare(s).run()
  }, 120_000)

  afterAll(async () => {
    // A hung request can keep dispose() pending; never let cleanup stall the run.
    await Promise.race([mf?.dispose(), new Promise((resolve) => setTimeout(resolve, 5_000).unref())])
    if (output) await rm(output, { recursive: true, force: true })
  })

  it('answers an unauthenticated get-session promptly (does not hang)', async () => {
    const started = Date.now()
    const res = await fetchWithin('/api/auth/get-session')
    expect(res.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('returns no session for anonymous session lookups', async () => {
    const res = await fetchWithin('/api/auth/get-session')
    expect(await res.json()).toBeNull()
  })

  it('signs up, resolves the session by cookie, and signs out', async () => {
    const signUp = await post('/sign-up/email', {
      email: 'workerd@example.com', password: 'correct-horse-battery', name: 'Workerd', role: 'admin',
    })
    expect(signUp.status).toBe(200)
    const setCookie = signUp.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`))!
    expect(setCookie).toBeTruthy()
    const cookie = setCookie.split(';')[0]

    const session = await (await fetchWithin('/api/auth/get-session', { headers: { cookie } })).json() as any
    expect(session.user).toMatchObject({ email: 'workerd@example.com', role: 'user' })

    expect((await post('/sign-out', {}, { cookie })).status).toBe(200)
    expect(await (await fetchWithin('/api/auth/get-session', { headers: { cookie } })).json()).toBeNull()
  })

  it('signs in with a password after sign-up and rejects a wrong one', async () => {
    await post('/sign-up/email', { email: 'login-wd@example.com', password: 'correct-horse-battery', name: 'L' })
    const ok = await post('/sign-in/email', { email: 'login-wd@example.com', password: 'correct-horse-battery' })
    expect(ok.status).toBe(200)
    const bad = await post('/sign-in/email', { email: 'login-wd@example.com', password: 'wrong-password-1' })
    expect(bad.status).toBeGreaterThanOrEqual(400)
  })
})

