/**
 * Exercises the parts of Hono / @hono/node-server that Zebric actually relies on
 * (form body parsing, the cookie helper behind CSRF, wildcard file serving, the
 * Node HTTP adapter). They run against the real libraries so dependency upgrades
 * are caught here rather than in production.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { serve, type ServerType } from '@hono/node-server'
import { request as httpRequest } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseActionRequestBody } from './server-utils.js'
import { applyCsrfProtection } from './server-security.js'
import { registerStaticUploads } from './server-routes.js'

function bodyApp() {
  const app = new Hono()
  app.post('/action', async (c) => c.json(await parseActionRequestBody(c)))
  return app
}

describe('form body parsing (parseBody)', () => {
  it('parses urlencoded forms into flat keys', async () => {
    const res = await bodyApp().request('/action', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'title=Hello&done=on&note=a%20b',
    })
    expect(await res.json()).toEqual({ title: 'Hello', done: 'on', note: 'a b' })
  })

  it('parses multipart forms', async () => {
    const form = new FormData()
    form.set('title', 'Multi')
    form.set('tags', 'x')
    const res = await bodyApp().request('/action', { method: 'POST', body: form })
    expect(await res.json()).toEqual({ title: 'Multi', tags: 'x' })
  })

  it('does not expand dotted or bracketed keys into nested objects', async () => {
    const res = await bodyApp().request('/action', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a.b.c=1&user[role]=admin',
    })
    const body = await res.json()
    expect(body['a.b.c']).toBe('1')
    expect(body['user[role]']).toBe('admin')
    expect(body.a).toBeUndefined()
    expect(body.user).toBeUndefined()
  })

  it('survives extremely deep dot-notation keys quickly without nesting', async () => {
    const key = Array.from({ length: 50_000 }, () => 'a').join('.')
    const started = Date.now()
    const res = await bodyApp().request('/action', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `${key}=1`,
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(Object.keys(body)).toEqual([key])
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('does not allow prototype pollution via __proto__ keys', async () => {
    const res = await bodyApp().request('/action', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '__proto__.polluted=yes&constructor.prototype.polluted=yes',
    })
    expect(res.status).toBe(200)
    expect(({} as any).polluted).toBeUndefined()
  })

  it('returns {} for malformed JSON and unsupported content types', async () => {
    const app = bodyApp()
    const bad = await app.request('/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    })
    expect(await bad.json()).toEqual({})
    const text = await app.request('/action', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hi',
    })
    expect(await text.json()).toEqual({})
  })
})

describe('cookie helper / CSRF cookie', () => {
  const csrfApp = () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      const blocked = await applyCsrfProtection(c, 'csrf-token', new Map())
      if (blocked) return blocked
      return next()
    })
    app.get('/page', (c) => c.text('ok'))
    app.post('/submit', (c) => c.text('posted'))
    return app
  }

  it('issues a strict, path-scoped CSRF cookie on a safe request', async () => {
    const res = await csrfApp().request('/page')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^csrf-token=[0-9a-f-]{36}/)
    expect(cookie).toMatch(/SameSite=Strict/i)
    expect(cookie).toMatch(/Path=\//)
  })

  it('rejects unsafe requests without a matching token, accepts them with one', async () => {
    const app = csrfApp()
    const none = await app.request('/submit', { method: 'POST' })
    expect(none.status).toBe(403)

    const mismatch = await app.request('/submit', {
      method: 'POST',
      headers: { cookie: 'csrf-token=abc', 'x-csrf-token': 'different' },
    })
    expect(mismatch.status).toBe(403)

    const ok = await app.request('/submit', {
      method: 'POST',
      headers: { cookie: 'csrf-token=abc', 'x-csrf-token': 'abc' },
    })
    expect(ok.status).toBe(200)
  })

  it('does not let attacker-controlled option values inject extra Set-Cookie attributes', async () => {
    const app = new Hono()
    app.get('/c', (c) => {
      try {
        setCookie(c, 'k', 'v', { sameSite: 'Strict; Domain=evil.example' as any })
      } catch {
        // throwing is also an acceptable way to refuse
      }
      return c.text('ok')
    })
    const res = await app.request('/c')
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/evil\.example/)
  })

  it('percent-encodes cookie values that contain separators', async () => {
    const app = new Hono()
    app.get('/c', (c) => {
      setCookie(c, 'k', 'a;b=c')
      return c.text('ok')
    })
    const res = await app.request('/c')
    expect(res.headers.get('set-cookie')).toMatch(/^k=a%3Bb%3Dc/)
  })
})

describe('static uploads route', () => {
  let cwd: string
  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'zebric-uploads-'))
    mkdirSync(join(cwd, 'data/uploads/sub'), { recursive: true })
    writeFileSync(join(cwd, 'data/uploads/hello.txt'), 'hello')
    writeFileSync(join(cwd, 'data/uploads/sub/nested.txt'), 'nested')
    writeFileSync(join(cwd, 'secret.txt'), 'top-secret')
    vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  })
  afterAll(() => {
    vi.restoreAllMocks()
    rmSync(cwd, { recursive: true, force: true })
  })

  const get = async (path: string) => {
    const app = new Hono()
    registerStaticUploads(app)
    return app.request(path)
  }

  it('serves files inside the uploads directory', async () => {
    expect(await (await get('/uploads/hello.txt')).text()).toBe('hello')
    expect(await (await get('/uploads/sub/nested.txt')).text()).toBe('nested')
  })

  it.each([
    '/uploads/../secret.txt',
    '/uploads/..%2fsecret.txt',
    '/uploads/%2e%2e/secret.txt',
    '/uploads/%2e%2e%2fsecret.txt',
    '/uploads/sub/../../secret.txt',
    '/uploads/..%5csecret.txt',
    '/uploads/%252e%252e/secret.txt',
    '/uploads//etc/passwd',
  ])('does not serve files outside uploads for %s', async (path) => {
    const res = await get(path)
    expect(await res.text()).not.toContain('top-secret')
    expect(res.status).not.toBe(200)
  })
})

describe('@hono/node-server adapter', () => {
  let server: ServerType | undefined
  let port = 0

  afterEach(async () => {
    if (server) await new Promise((r) => server!.close(() => r(undefined)))
    server = undefined
  })

  const start = async (app: Hono) => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = (info as AddressInfo).port
        resolve()
      })
    })
  }

  it('serves requests end to end, including form posts and multiple Set-Cookie headers', async () => {
    const app = new Hono()
    app.post('/echo', async (c) => {
      setCookie(c, 'a', '1')
      setCookie(c, 'b', '2')
      return c.json(await parseActionRequestBody(c))
    })
    await start(app)

    const res = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'x=1&y=two',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ x: '1', y: 'two' })
    expect(res.headers.getSetCookie()).toHaveLength(2)
  })

  it('stays healthy when clients abort mid-request', async () => {
    const app = new Hono()
    app.post('/slow', async (c) => c.json(await parseActionRequestBody(c)))
    app.get('/ping', (c) => c.text('pong'))
    await start(app)

    await new Promise<void>((resolve) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, method: 'POST', path: '/slow', headers: { 'content-type': 'application/json', 'content-length': '1000' } },
        () => resolve()
      )
      req.on('error', () => resolve())
      req.write('{"partial":')
      setTimeout(() => req.destroy(), 20)
    })

    const res = await fetch(`http://127.0.0.1:${port}/ping`)
    expect(await res.text()).toBe('pong')
  })

  it('stays healthy after an aborted WebSocket-style upgrade handshake', async () => {
    const app = new Hono()
    app.get('/ping', (c) => c.text('pong'))
    await start(app)

    await new Promise<void>((resolve) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          'GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
            'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'
        )
        setTimeout(() => { socket.destroy(); resolve() }, 20)
      })
      socket.on('error', () => resolve())
    })

    const res = await fetch(`http://127.0.0.1:${port}/ping`)
    expect(await res.text()).toBe('pong')
  })
})
