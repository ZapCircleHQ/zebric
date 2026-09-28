import { test as base, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { createServer } from 'node:net'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createZebric, type Zebric } from '../../../dist/programmatic.js'

export const ADMIN_EMAIL = 'playwright-admin@dispatch.test'
export const ADMIN_PASSWORD = 'Playwright1!'
export const SEEDED_CATEGORY_NAME = 'Playwright General'

const CSRF_TOKEN = 'zebric-playwright-csrf'

type ZebricServer = {
  baseURL: string
  blueprintPath: string
  dbPath: string
  tmpRoot: string
}

type Fixtures = {
  app: ZebricServer
}

export const test = base.extend<Fixtures>({
  app: [
    async ({}, use) => {
      const tmpRoot = await mkdtemp(join(tmpdir(), 'zebric-playwright-'))
      const dbPath = join(tmpRoot, 'app.db')
      const blueprintPath = join(tmpRoot, 'blueprint.toml')
      const sourceDir = resolve(process.cwd(), '../../examples/zebric-dispatch')
      const sourceBlueprint = join(sourceDir, 'blueprint.toml')
      const port = await findOpenPort()
      const baseURL = `http://127.0.0.1:${port}`
      let zebric: Zebric | undefined

      try {
        await writeFile(blueprintPath, await readFile(sourceBlueprint, 'utf8'), 'utf8')
        // Custom page/auth templates are loaded from disk relative to the
        // blueprint file, so the example's templates/ directory has to live
        // alongside the copied blueprint.toml too.
        await cp(join(sourceDir, 'templates'), join(tmpRoot, 'templates'), { recursive: true })

        zebric = await createZebric({
          blueprintPath,
          host: '127.0.0.1',
          port,
          databaseUrl: `sqlite://${dbPath}`,
          validateBeforeStart: false,
          // Required so Better Auth resolves its own SQLite connection to this
          // same tmp dbPath: outside dev mode, the auth provider's db path
          // falls back to ./data/app.db regardless of `databaseUrl` above.
          dev: true,
        })

        await waitForHttp(`${baseURL}/health`, 15_000)
        await provisionAdminAndCategory(baseURL, dbPath)
        await use({ baseURL, blueprintPath, dbPath, tmpRoot })
      } finally {
        if (zebric) {
          await zebric.stop()
        }
        await rm(tmpRoot, { recursive: true, force: true })
      }
    },
    { scope: 'worker' },
  ],
})

export { expect } from '@playwright/test'

// Signs a test's browser context in as the fixture-seeded admin account.
// Uses page.request so the session cookie lands in this test's own browser
// context (not a shared Node fetch jar), and the CSRF cookie is set via the
// context directly since it does not need to come from the server first.
export async function signInAsAdmin(page: Page, baseURL: string): Promise<void> {
  await page.context().addCookies([{ name: 'csrf-token', value: CSRF_TOKEN, url: baseURL }])
  const response = await page.request.post(`${baseURL}/api/auth/sign-in/email`, {
    headers: { 'x-csrf-token': CSRF_TOKEN, origin: baseURL },
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  if (!response.ok()) {
    throw new Error(`Browser sign-in failed: ${response.status()} ${await response.text()}`)
  }
}

async function findOpenPort(): Promise<number> {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate a TCP port'))
        return
      }
      const port = address.port
      server.close(() => resolvePromise(port))
    })
    server.on('error', reject)
  })
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }

  throw new Error(`Timed out waiting for server: ${url}`)
}

// Dispatch pages require an authenticated session, and creating a Request
// requires an existing RequestCategory. Both are provisioned here the same
// way the example's seed.sh does it: sign up over HTTP, then promote the
// account to admin directly in SQLite (there is no self-service admin
// promotion API, by design), then use that admin session to seed one
// category so the browser tests have something to select and assign.
async function provisionAdminAndCategory(baseURL: string, dbPath: string): Promise<void> {
  const baseHeaders = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-csrf-token': CSRF_TOKEN,
    cookie: `csrf-token=${CSRF_TOKEN}`,
    origin: baseURL,
  }

  await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Playwright Admin' }),
  })

  const db = new Database(dbPath)
  try {
    db.prepare(`UPDATE user SET role = 'admin' WHERE email = ?`).run(ADMIN_EMAIL)
  } finally {
    db.close()
  }

  const signInResponse = await fetch(`${baseURL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  if (!signInResponse.ok) {
    throw new Error(`Fixture admin sign-in failed: ${signInResponse.status} ${await signInResponse.text()}`)
  }
  const sessionCookies = signInResponse.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

  const categoryResponse = await fetch(`${baseURL}/api/requestcategorys`, {
    method: 'POST',
    headers: { ...baseHeaders, cookie: `csrf-token=${CSRF_TOKEN}; ${sessionCookies}` },
    body: JSON.stringify({
      name: SEEDED_CATEGORY_NAME,
      slug: 'playwright-general',
      workflowKey: 'general',
      active: true,
    }),
  })
  if (!categoryResponse.ok) {
    throw new Error(`Fixture category seed failed: ${categoryResponse.status} ${await categoryResponse.text()}`)
  }
}
