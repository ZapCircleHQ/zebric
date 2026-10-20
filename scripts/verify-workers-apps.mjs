import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(join(tmpdir(), 'zebric-workers-apps-'))
const artifacts = join(temporary, 'artifacts')
const apps = ['starters/cloudflare-workers', 'examples/workers-blog']
const environment = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true', pnpm_config_pm_on_fail: 'ignore' }

function run(args, cwd) {
  try {
    return execFileSync('pnpm', args, { cwd, env: environment, encoding: 'utf8', timeout: 180000, stdio: 'pipe' })
  } catch (error) {
    process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''))
    throw error
  }
}

try {
  // Keep the entrypoint, typing and auth schema on a single maintained contract.
  for (const file of ['worker.ts', 'modules.d.ts', 'tsconfig.json', 'pnpm-workspace.yaml', '.dev.vars.example', '.gitignore', 'migrations/0000_auth.sql', 'scripts/predeploy.mjs']) {
    assert.equal(readFileSync(join(root, apps[0], file), 'utf8'), readFileSync(join(root, apps[1], file), 'utf8'), `${file} foundation drift`)
  }
  mkdirSync(artifacts)
  const overrides = {}
  for (const name of ['runtime-core', 'runtime-hono', 'notifications', 'runtime-worker']) {
    run(['pack', '--pack-destination', artifacts], join(root, 'packages', name))
    const tarball = readdirSync(artifacts).find(file => file.startsWith(`zebric-${name}-`) && file.endsWith('.tgz'))
    assert.ok(tarball, `Missing ${name} package`)
    overrides[`@zebric/${name}`] = `file:${join(artifacts, tarball)}`
  }

  for (const [index, app] of apps.entries()) {
    const consumer = join(temporary, `app-${index}`)
    cpSync(join(root, app), consumer, { recursive: true, filter: source => !['node_modules', 'dist', '.wrangler', '.dev.vars'].includes(source.split('/').at(-1)) })
    const manifest = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'))
    assert.match(manifest.dependencies['@zebric/runtime-worker'], /^\d+\.\d+\.\d+$/)
    assert.equal(manifest.dependencies['@zebric/runtime-worker'], JSON.parse(readFileSync(join(root, 'packages/runtime-worker/package.json'), 'utf8')).version, 'Update the app release dependency alongside the runtime')
    // Only local release artifacts are substituted; the copied app never links
    // to workspace source. Make accidental @zebric registry resolution fail.
    writeFileSync(join(consumer, '.npmrc'), '@zebric:registry=http://127.0.0.1:9/\n')
    const workspace = readFileSync(join(consumer, 'pnpm-workspace.yaml'), 'utf8')
    assert.ok(workspace.includes('overrides:\n'), 'Standalone auth pin must be present')
    writeFileSync(join(consumer, 'pnpm-workspace.yaml'), workspace.replace('overrides:\n', `overrides:\n${Object.entries(overrides).map(([name, path]) => `  '${name}': ${JSON.stringify(path)}`).join('\n')}\n`))
    const install = ['install', '--frozen-lockfile=false']
    if (process.env.ZEBRIC_PACKAGE_SMOKE_OFFLINE === '1') install.push('--offline')
    run(install, consumer)
    run(['run', 'check'], consumer)
    run(['run', 'build'], consumer)
    // Execute the documented migration command, including its tracking table.
    run(['run', 'db:migrate'], consumer)
    run(['run', 'db:migrate'], consumer) // applying again must not recreate schema
    process.stdout.write(`${app}: installed, bundled and migrated; checking HTTP/auth\n`)
    await exercise(consumer, index === 1)
    process.stdout.write(`${app}: clean install, types, bundle, migrations, auth and CRUD passed\n`)
  }
} finally {
  rmSync(temporary, { recursive: true, force: true })
}

async function exercise(consumer, blog) {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  writeFileSync(join(consumer, '.dev.vars'), `BETTER_AUTH_URL=${origin}\nBETTER_AUTH_SECRET=package-test-secret-at-least-32-characters\n`)
  const worker = spawn(process.execPath, [join(consumer, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--ip', '127.0.0.1', '--port', String(port), '--log-level', 'error'], {
    cwd: consumer, env: environment, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  })
  let logs = ''
  worker.stdout.on('data', chunk => { logs += chunk })
  worker.stderr.on('data', chunk => { logs += chunk })
  try {
    const deadline = Date.now() + 45000
    let ready = false
    while (Date.now() < deadline && worker.exitCode === null) {
      try { ready = (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })).ok } catch { /* startup */ }
      if (ready) break
      await delay(100)
    }
    assert.ok(ready, `Worker did not become healthy:\n${logs}`)
    const anonymous = browser(origin)
    const entity = blog ? 'posts' : 'tasks'
    const title = blog ? 'Published Posts' : 'My Tasks'
    const initial = await anonymous('/')
    assert.equal(initial.status, blog ? 200 : 303)
    if (blog) assert.match(await initial.text(), new RegExp(title))
    const api = `/api/${entity}`
    const data = blog ? { title: 'Private draft', body: 'Draft body' } : { title: 'Private task' }
    const unauthorized = await anonymous(api, { method: 'POST', body: data })
    assert.ok([401, 403].includes(unauthorized.status), `Anonymous create: ${unauthorized.status}`)

    const alice = browser(origin)
    const bob = browser(origin)
    const aliceUser = await register(alice, 'alice@example.test')
    await register(bob, 'bob@example.test')
    const newPage = await alice(`/${entity}/new`)
    assert.equal(newPage.status, 200)
    assert.match(await newPage.text(), /<form/)
    const csrfFailure = await alice(api, { method: 'POST', body: data, csrf: false })
    assert.equal(csrfFailure.status, 403)
    // Ownership and primary keys cannot be supplied or transferred by clients.
    const created = await alice(api, { method: 'POST', body: { ...data, userId: 'forged-owner', id: 'forged-id' } })
    assert.equal(created.status, 201, await created.clone().text())
    const record = await created.json()
    assert.equal(record.userId, aliceUser.id)
    assert.notEqual(record.id, 'forged-id')
    assert.equal(blog ? record.published : record.completed, false)
    const item = `${api}/${record.id}`
    assert.equal((await alice(`/${entity}/${record.id}`)).status, 200)
    assert.equal((await alice(`/${entity}/${record.id}/edit`)).status, 200)
    assert.equal((await bob(item)).status, 404)
    assert.equal((await anonymous(item)).status, blog ? 404 : 403)
    const forbidden = await bob(item, { method: 'PUT', body: { title: 'Stolen' } })
    assert.ok([403, 404].includes(forbidden.status))
    assert.ok([403, 404].includes((await bob(item, { method: 'DELETE' })).status))
    assert.deepEqual(await (await bob(api)).json(), [])
    if (blog) {
      const home = await anonymous('/')
      assert.doesNotMatch(await home.text(), /Private draft/)
    }

    const updated = await alice(item, { method: 'PUT', body: { title: 'Updated record', userId: 'forged-owner', ...(blog ? { published: true } : { completed: true }) } })
    assert.equal(updated.status, 200, await updated.clone().text())
    const changed = await updated.json()
    assert.equal(changed.userId, aliceUser.id)
    assert.equal(blog ? changed.published : changed.completed, true)
    const editPath = `/${entity}/${record.id}/edit`
    const editHtml = await (await alice(editPath)).text()
    const checkbox = blog ? 'published' : 'completed'
    // Enhanced forms serialize FormData to JSON; native forms retain duplicate keys.
    const formFields = { title: 'Edited through form', ...(blog ? { body: 'Updated body' } : {}) }
    const formSave = await alice(editPath, { method: 'POST', body: { ...formFields, ...Object.fromEntries(checkboxSubmission(editHtml, checkbox, true)) } })
    assert.equal(formSave.status, 200, await formSave.clone().text())
    assert.equal((await formSave.json()).redirect, blog ? `/posts/${record.id}` : '/')
    assert.equal((await (await alice(item)).json()).title, 'Edited through form')
    assert.equal((await (await alice(item)).json())[checkbox], true)
    if (blog) {
      assert.equal((await anonymous(item)).status, 200)
      assert.match(await (await anonymous('/')).text(), /Edited through form/)
      assert.equal((await bob(item, { method: 'PUT', body: { title: 'Still stolen' } })).status, 403)
    }
    const uncheckedFields = checkboxSubmission(editHtml, checkbox, false)
    for (const [name, value] of Object.entries(formFields)) uncheckedFields.set(name, value)
    const uncheckedSave = await alice(editPath, { method: 'POST', form: uncheckedFields })
    assert.equal(uncheckedSave.status, 200, await uncheckedSave.clone().text())
    assert.equal((await (await alice(item)).json())[checkbox], false)
    if (blog) {
      assert.equal((await anonymous(item)).status, 404)
      assert.doesNotMatch(await (await anonymous('/')).text(), /Edited through form/)
    }

    assert.equal((await alice('/api/auth/sign-out', { method: 'POST', body: {} })).status, 200)
    assert.equal(await (await alice('/api/auth/get-session')).json(), null)
    const signedIn = await alice('/api/auth/sign-in/email', { method: 'POST', body: { email: 'alice@example.test', password: 'WorkersTestPass123!' } })
    assert.equal(signedIn.status, 200, await signedIn.clone().text())
    assert.equal((await alice(item)).status, 200)
    const removed = await alice(item, { method: 'DELETE' })
    assert.ok([200, 204].includes(removed.status))
    assert.equal((await alice(item)).status, 404)
    const formCreate = await alice(`/${entity}/new`, { method: 'POST', form: { title: 'Created through form', ...(blog ? { body: 'Form body' } : {}) } })
    assert.equal(formCreate.status, 200, await formCreate.clone().text())
    const formRecord = (await formCreate.json()).data
    assert.equal(formRecord.userId, aliceUser.id)
    const detailHtml = (await (await alice(`/${entity}/${formRecord.id}`)).text()).replaceAll('&#x2F;', '/')
    const deleteLink = detailHtml.match(/<a\s+href="([^"]+)"[^>]*>\s*Delete\s*<\/a>/)?.[1]
    assert.equal(deleteLink, `/${entity}/${formRecord.id}/delete`, 'Delete must open the confirmation form')
    assert.equal((await alice(deleteLink)).status, 200)
    const formDelete = await alice(deleteLink, { method: 'POST', form: {} })
    assert.equal(formDelete.status, 200, await formDelete.clone().text())
    assert.equal((await formDelete.json()).redirect, '/')
    assert.equal((await alice('/')).status, 200)
    assert.equal((await alice(`${api}/${formRecord.id}`)).status, 404)
  } catch (error) {
    process.stderr.write(logs)
    throw error
  } finally {
    const exited = new Promise(resolveExit => worker.once('exit', resolveExit))
    if (worker.exitCode === null) {
      if (process.platform === 'win32') worker.kill()
      else process.kill(-worker.pid, 'SIGTERM')
      await exited
    }
  }
}

function browser(origin) {
  const cookies = new Map()
  return async (path, { method = 'GET', body, form, csrf = true } = {}) => {
    const headers = new Headers({ origin, cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') })
    if (body !== undefined) headers.set('content-type', 'application/json')
    if (form) headers.set('content-type', 'application/x-www-form-urlencoded')
    if (csrf && !['GET', 'HEAD'].includes(method)) headers.set('x-csrf-token', cookies.get('csrf-token') ?? '')
    const formBody = form ? new URLSearchParams(form) : undefined
    if (formBody) formBody.set('_csrf', cookies.get('csrf-token') ?? '')
    let response
    try {
      response = await fetch(`${origin}${path}`, { method, headers, body: formBody ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual', signal: AbortSignal.timeout(20000) })
    } catch (cause) {
      throw new Error(`${method} ${path} failed`, { cause })
    }
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

function checkboxSubmission(html, name, checked) {
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(([input]) => input)
    .filter(input => input.includes(`name="${name}"`))
  assert.equal(inputs.length, 2, `${name} needs a hidden false value and a checkbox`)
  const values = new URLSearchParams()
  for (const input of inputs) {
    if (input.includes('type="checkbox"') && !checked) continue
    const value = input.match(/value="([^"]*)"/)?.[1]
    assert.ok(value !== undefined, `${name} input needs an explicit value`)
    values.append(name, value)
  }
  assert.equal(values.getAll(name).at(-1), String(checked))
  return values
}

async function register(client, email) {
  assert.equal((await client('/auth/sign-up')).status, 200)
  const response = await client('/api/auth/sign-up/email', { method: 'POST', body: { name: email, email, password: 'WorkersTestPass123!', role: 'admin' } })
  assert.equal(response.status, 200, await response.clone().text())
  const { user } = await response.json()
  assert.equal(user.role, 'user')
  return user
}

async function freePort() {
  const server = createServer()
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const port = server.address().port
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}
