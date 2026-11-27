import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'zebric-cli-app-'))
const artifacts = join(temporary, 'artifacts')
const consumer = join(temporary, 'app')
const environment = { ...process.env, CI: 'true', NODE_ENV: 'development', pnpm_config_pm_on_fail: 'ignore' }
// This journey needs no external services or credentials from the developer shell.
delete environment.REDIS_URL
environment.BETTER_AUTH_SECRET = 'cli-smoke-test-secret-at-least-32-characters'

function run(args, cwd) {
  try {
    return execFileSync('pnpm', args, { cwd, env: environment, encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL', stdio: 'pipe' })
  } catch (error) {
    process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''))
    throw new Error(`pnpm ${args.join(" ")} failed (${error.status ?? error.code ?? error.signal})`)
  }
}

try {
  mkdirSync(artifacts)
  mkdirSync(consumer)
  const overrides = {}
  for (const name of ['runtime-core', 'runtime-hono', 'notifications', 'observability', 'runtime-node', 'cli']) {
    run(['pack', '--pack-destination', artifacts], join(root, 'packages', name))
    const tarballs = readdirSync(artifacts).filter(file => file.startsWith(`zebric-${name}-`) && file.endsWith('.tgz'))
    assert.equal(tarballs.length, 1, `Expected one ${name} package`)
    overrides[`@zebric/${name}`] = `file:${join(artifacts, tarballs[0])}`
  }
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    name: 'zebric-first-app-smoke', private: true, type: 'module',
    dependencies: { '@zebric/cli': overrides['@zebric/cli'] },
  }, null, 2))
  // Never resolve a Zebric package from the registry or link workspace sources.
  writeFileSync(join(consumer, '.npmrc'), '@zebric:registry=http://127.0.0.1:9/\n')
  writeFileSync(join(consumer, 'pnpm-workspace.yaml'), `packages:\n  - .\nallowBuilds:\n  better-sqlite3: true\n  msgpackr-extract: false\noverrides:\n${Object.entries(overrides).map(([name, path]) => `  '${name}': ${JSON.stringify(path)}`).join('\n')}\n`)
  const install = ['install', '--frozen-lockfile=false']
  if (process.env.ZEBRIC_PACKAGE_SMOKE_OFFLINE === '1') install.push('--offline')
  process.stdout.write('Installing packed CLI in a standalone consumer...\n')
  run(install, consumer)
  const port = await freePortPair()
  const origin = `http://localhost:${port}`
  // Only the trusted origin changes to accommodate an available local test port.
  const blueprint = readFileSync(join(root, 'packages/docs/public/quickstart/blueprint.toml'), 'utf8')
    .replace('http://localhost:3000', origin)
  const blueprintPath = join(consumer, 'blueprint.toml')
  writeFileSync(blueprintPath, blueprint)
  assert.match(run(['exec', 'zebric', 'validate', '--blueprint', 'blueprint.toml'], consumer), /Blueprint valid/)
  await exercise(origin, port, blueprintPath, blueprint)
  process.stdout.write('CLI first app passed: install, validate, seed, auth, form save, reload, restart and persistence.\n')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

async function exercise(origin, port, blueprintPath, blueprint) {
  let server
  let socket
  try {
    server = await start(port, origin)
    const anonymous = browser(origin)
    const home = await anonymous('/')
    assert.equal(home.status, 200)
    const html = await home.text()
    assert.match(html, /Welcome to Zebric/)
    assert.match(html, /All Posts/)
    assert.match(html, /__reload/, 'Development page must include the reload client')
    const initial = await (await anonymous('/api/posts')).json()
    assert.equal(initial.length, 3)
    assert.equal((await anonymous(`/posts/${initial[0].id}`)).status, 200)
    const protectedForm = await anonymous('/posts/new')
    assert.ok([302, 303].includes(protectedForm.status))
    assert.match(protectedForm.headers.get('location'), /auth\/sign-in/)
    for (const [path, method, body] of [
      ['/api/posts', 'POST', { title: 'Anonymous', body: 'Denied' }],
      [`/api/posts/${initial[0].id}`, 'PUT', { title: 'Anonymous edit' }],
      [`/api/posts/${initial[0].id}`, 'DELETE', undefined],
    ]) {
      const response = await anonymous(path, { method, body })
      assert.ok([401, 403].includes(response.status), `Anonymous ${method} returned ${response.status}`)
    }
    const author = browser(origin)
    assert.equal((await author('/auth/sign-up')).status, 200)
    const signup = await author('/api/auth/sign-up/email', { method: 'POST', body: {
      name: 'First Author', email: 'first-author@example.test', password: 'FirstAppPass123!',
    } })
    assert.equal(signup.status, 200, await signup.clone().text())
    const form = await author('/posts/new')
    assert.equal(form.status, 200)
    assert.match(await form.text(), /name="title"/)
    const saved = await author('/posts/new', { method: 'POST', form: { title: 'My first post', body: 'Created through the first-app form' } })
    assert.equal(saved.status, 200, await saved.clone().text())
    assert.equal((await saved.json()).redirect, '/')
    const records = await (await anonymous('/api/posts')).json()
    assert.equal(records.length, 4)
    const post = records.find(record => record.title === 'My first post')
    assert.ok(post, 'Form submission must persist a post')
    assert.match(await (await anonymous(`/posts/${post.id}`)).text(), /Created through the first-app form/)
    assert.match(await (await author('/')).text(), /My first post/)
    // Assert both ends of live reload: notification and the updated rendered page.
    socket = new WebSocket(`${origin.replace('http:', 'ws:')}/__reload`)
    await socketEvent(socket, 'connected')
    const reloaded = socketEvent(socket, 'reload')
    writeFileSync(blueprintPath, blueprint.replace('title = "All Posts"', 'title = "My Posts"'))
    await reloaded
    assert.match(await (await anonymous('/')).text(), /My Posts/)
    socket.close()
    socket = undefined
    await server.stop()
    server = await start(port, origin)
    const persisted = await (await anonymous('/api/posts')).json()
    assert.equal(persisted.length, 4, 'Restart with --seed must not duplicate records')
    assert.ok(persisted.some(record => record.id === post.id && record.title === 'My first post'))
    assert.match(await (await anonymous('/')).text(), /My Posts/)
    // Signing back in after restart also verifies the auth data survived.
    const returning = browser(origin)
    await returning('/auth/sign-in')
    const signin = await returning('/api/auth/sign-in/email', { method: 'POST', body: {
      email: 'first-author@example.test', password: 'FirstAppPass123!',
    } })
    assert.equal(signin.status, 200, await signin.clone().text())
    assert.equal((await returning('/posts/new')).status, 200)
  } catch (error) {
    if (server) process.stderr.write(server.logs())
    throw error
  } finally {
    socket?.close()
    await server?.stop()
  }
}

async function start(port, origin) {
  // Spawn the installed binary itself, not an engine imported from the workspace.
  const cli = join(consumer, 'node_modules/@zebric/cli/dist/index.js')
  const child = spawn(process.execPath, [cli, 'dev', '--blueprint', 'blueprint.toml', '--port', String(port), '--seed'], {
    cwd: consumer, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  const capture = chunk => { logs = (logs + chunk).slice(-64000) }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  let spawnError
  child.on('error', error => { spawnError = error })
  const handle = {
    logs: () => logs,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null || spawnError) return
      child.kill('SIGTERM')
      let timer
      try {
        await Promise.race([exited, new Promise((_, reject) => {
          timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`CLI did not stop:\n${logs}`)) }, 10000)
        })])
      } finally { clearTimeout(timer) }
    },
  }
  try {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline && child.exitCode === null && !spawnError) {
      try {
        if ((await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).ok) return handle
      } catch { /* Wait for startup. */ }
      await delay(100)
    }
    throw new Error(`CLI did not become healthy: ${spawnError ?? ''}\n${logs}`)
  } catch (error) {
    await handle.stop()
    throw error
  }
}

function socketEvent(socket, expected) {
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => finish(new Error(`No ${expected} reload event`)), 10000)
    function finish(error, value) {
      clearTimeout(timer)
      socket.removeEventListener('message', message)
      socket.removeEventListener('error', failed)
      socket.removeEventListener('close', failed)
      if (error) reject(error)
      else resolveEvent(value)
    }
    function message(event) {
      try {
        const data = JSON.parse(event.data)
        if (data.type === expected) finish(null, data)
        else if (data.type === 'error') finish(new Error(data.message))
      } catch (error) { finish(error) }
    }
    function failed() { finish(new Error(`Reload socket closed or failed before ${expected}`)) }
    socket.addEventListener('message', message)
    socket.addEventListener('error', failed)
    socket.addEventListener('close', failed)
  })
}

function browser(origin) {
  const cookies = new Map()
  return async (path, { method = 'GET', body, form } = {}) => {
    const headers = new Headers({ origin, cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') })
    if (body !== undefined) headers.set('content-type', 'application/json')
    if (form) headers.set('content-type', 'application/x-www-form-urlencoded')
    const token = cookies.get('csrf-token') ?? ''
    if (!['GET', 'HEAD'].includes(method)) headers.set('x-csrf-token', token)
    const formBody = form ? new URLSearchParams({ ...form, _csrf: token }) : undefined
    const response = await fetch(`${origin}${path}`, {
      method, headers, body: formBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      redirect: 'manual', signal: AbortSignal.timeout(5000),
    })
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]
      const separator = pair.indexOf('=')
      const name = pair.slice(0, separator)
      const value = pair.slice(separator + 1)
      if (value) cookies.set(name, value)
      else cookies.delete(name)
    }
    return response
  }
}

async function freePortPair() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const app = createServer()
    const admin = createServer()
    try {
      await listen(app, 0)
      const port = app.address().port
      if (port > 65505) continue
      await listen(admin, port + 30)
      return port
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error
    } finally {
      await Promise.all([app, admin].map(server => new Promise(resolveClose => server.close(resolveClose))))
    }
  }
  throw new Error('Could not find available app and admin ports')
}

function listen(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, 'localhost', () => { server.removeListener('error', reject); resolveListen() })
  })
}
