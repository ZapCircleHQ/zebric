import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, symlink, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { ZebricEngine } from '../packages/runtime-node/dist/index.js'
import { createRuntimeReadTools, DeterministicAgentDriver, discoverZebricApplication } from '../packages/agent/dist/index.js'

const execFileAsync = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const require = createRequire(join(root, 'packages/runtime-node/package.json'))
const { chromium } = require('@playwright/test')
const temporary = await mkdtemp(join(tmpdir(), 'zebric-human-agent-'))
const publisherKey = 'local-feature-tutorial-key'
const readerKey = 'local-reader-tutorial-key'
const previous = { FEATURE_POST_API_KEY: process.env.FEATURE_POST_API_KEY, READER_API_KEY: process.env.READER_API_KEY }
process.env.FEATURE_POST_API_KEY = publisherKey
process.env.READER_API_KEY = readerKey
let engine
let browser
let page
try {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const blueprintPath = join(temporary, 'blueprint.toml')
  const original = (await readFile(join(root, 'packages/docs/public/quickstart/blueprint.toml'), 'utf8')).replace('http://localhost:3000', origin)
  const completed = (await readFile(join(root, 'packages/docs/public/human-and-agent/blueprint.toml'), 'utf8')).replace('http://localhost:3000', origin)
  await writeFile(blueprintPath, original)
  const config = { blueprintPath, host: '127.0.0.1', port,
    dev: { dbPath: join(temporary, 'app.db'), adminPort: 0, seed: true, hotReload: true, logLevel: 'error' } }
  engine = new ZebricEngine(config)
  await engine.start()
  await until(async () => (await fetch(`${origin}/health`)).ok)
  await writeFile(blueprintPath, completed)
  await until(async () => {
    const posts = await (await fetch(`${origin}/api/posts`)).json()
    return posts.length === 3 && posts.every(post => post.featured === false)
  })
  // Keys are read on startup, matching the tutorial's edit/reload/restart sequence.
  await engine.stop()
  engine = new ZebricEngine(config)
  await engine.start()
  await until(async () => (await fetch(`${origin}/health`)).ok)

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.setDefaultNavigationTimeout(10000)
  console.log('Checking browser signup and form creation...')
  await page.goto(`${origin}/auth/sign-up`)
  await page.locator('[name="name"]').fill('Tutorial Author')
  await page.locator('[name="email"]').fill('author@example.test')
  await page.locator('[name="password"]').fill('TutorialAuthor123!')
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await page.waitForURL(url => !url.pathname.includes('/auth/'))
  await page.goto(`${origin}/posts/new`)
  await page.locator('[name="title"]').fill('Featured by a person')
  await page.locator('[name="body"]').fill('A person uses the shared command.')
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(`${origin}/`)
  const posts = async () => (await (await fetch(`${origin}/api/posts`)).json())
  const humanPost = (await posts()).find(post => post.title === 'Featured by a person')
  assert.ok(humanPost)
  console.log('Checking the generated command button...')
  await page.goto(`${origin}/posts/${humanPost.id}`)
  const button = page.getByRole('button', { name: 'Feature post', exact: true })
  await button.waitFor()
  const anonymous = await browser.newContext()
  const publicPage = await anonymous.newPage()
  await publicPage.goto(`${origin}/posts/${humanPost.id}`)
  assert.equal(await publicPage.getByRole('button', { name: 'Feature post', exact: true }).count(), 0)
  page.on('dialog', dialog => dialog.accept())
  const [humanResponse] = await Promise.all([
    page.waitForResponse(response => response.url().includes(`/commands/feature_post/${humanPost.id}`) && response.request().method() === 'POST'),
    button.click(),
  ])
  assert.equal(humanResponse.status(), 303)
  await until(async () => (await posts()).find(post => post.id === humanPost.id)?.featured === true)
  await page.reload()
  assert.equal(await button.count(), 0)

  const agentPost = (await posts()).find(post => !post.featured)
  const guardedPost = (await posts()).filter(post => !post.featured)[1]
  assert.ok(agentPost && guardedPost)
  // Run the downloadable script unchanged with its installed-package import.
  const modules = join(temporary, 'node_modules/@zebric')
  await mkdir(modules, { recursive: true })
  await symlink(join(root, 'packages/agent'), join(modules, 'agent'))
  const script = join(temporary, 'feature-post.mjs')
  await writeFile(script, await readFile(join(root, 'packages/docs/public/human-and-agent/feature-post.mjs')))
  const { featurePost } = await import(pathToFileURL(script).href)
  const { stdout } = await execFileAsync(process.execPath, [script, agentPost.id], {
    env: { ...process.env, ZEBRIC_URL: origin }, timeout: 15000,
  })
  const output = JSON.parse(stdout)
  assert.equal(output.record.featured, true)
  await page.goto(`${origin}/posts/${agentPost.id}`)
  assert.equal(await button.count(), 0)
  await assert.rejects(featurePost({ baseUrl: origin, id: guardedPost.id, credential: readerKey }), error => error.status === 403 && error.code === 'AUTHORIZATION_FAILED')
  await assert.rejects(featurePost({ baseUrl: origin, id: agentPost.id, credential: publisherKey }), error => error.status === 409 && error.code === 'COMMAND_UNAVAILABLE')
  assert.equal((await posts()).find(post => post.id === guardedPost.id).featured, false)

  // A permitted generic edit cannot bypass the command-only field.
  const cookies = await context.cookies()
  const csrf = cookies.find(cookie => cookie.name === 'csrf-token')?.value
  assert.ok(csrf)
  const bypass = await context.request.put(`${origin}/api/posts/${guardedPost.id}`, {
    headers: { origin, 'x-csrf-token': csrf }, data: { featured: true },
  })
  assert.equal(bypass.status(), 409)
  assert.match((await bypass.json()).details, /Protected fields.*featured/)
  const anonymousCsrf = (await anonymous.cookies()).find(cookie => cookie.name === 'csrf-token')?.value
  assert.ok(anonymousCsrf)
  const unauthenticated = await anonymous.request.post(`${origin}/api/commands/feature_post/${guardedPost.id}`, {
    headers: { origin, 'x-csrf-token': anonymousCsrf }, data: {},
  })
  assert.equal(unauthenticated.status(), 401)
  assert.equal((await unauthenticated.json()).error.code, 'AUTHENTICATION_REQUIRED')
  const contract = await discoverZebricApplication(origin)
  const denied = new DeterministicAgentDriver(createRuntimeReadTools(contract, {
    applicationName: 'blog', credential: () => publisherKey, mutations: { approve: () => false },
  }))
  await assert.rejects(denied.invoke({ tool: 'blog_feature_post', input: { id: guardedPost.id } }), /not approved/i)
  assert.equal((await posts()).find(post => post.id === guardedPost.id).featured, false)
  console.log('Human-and-agent tutorial passed: existing-app migration, browser signup/form/button, generated agent tool, shared policy, state guard, approval denial and CRUD bypass rejection.')
} catch (error) {
  console.error(error)
  if (page && !page.isClosed()) console.error('Browser at:', page.url(), '\n', (await page.locator('body').innerText().catch(() => '')).slice(0, 4000))
  process.exitCode = 1
} finally {
  await cleanup(() => browser?.close())
  await cleanup(() => engine?.stop())
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  await cleanup(() => rm(temporary, { recursive: true, force: true }))
}

async function cleanup(action) {
  try { await action() } catch (error) { console.error('Tutorial cleanup failed:', error); process.exitCode = 1 }
}

async function until(check) {
  const deadline = Date.now() + 15000
  let lastError
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { lastError = error }
    await delay(100)
  }
  throw new Error('Tutorial state did not become ready', { cause: lastError })
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) })
  const port = server.address().port
  await new Promise(resolveClose => server.close(resolveClose))
  return port
}
