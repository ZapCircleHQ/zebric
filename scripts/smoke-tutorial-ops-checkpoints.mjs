#!/usr/bin/env node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { BlueprintParser } from '../packages/runtime-core/dist/blueprint/loader.js'
import { ZebricEngine } from '../packages/runtime-node/dist/index.js'

const repoRoot = resolve(import.meta.dirname, '..')
const checkpointDir = resolve(repoRoot, 'packages/docs/public/tutorial-ops/checkpoints')
const basePort = Number.parseInt(process.env.TUTORIAL_OPS_SMOKE_PORT || '4810', 10)
const host = '127.0.0.1'

const checkpoints = [
  {
    file: 'lesson-2-blueprint.toml',
    expectedEntity: 'ApprovalRequest',
    expectedWorkflow: 'ApproveRequest',
    protected: false,
  },
  {
    file: 'lesson-3-blueprint.toml',
    expectedEntity: 'ExceptionRequest',
    protected: false,
  },
  {
    file: 'lesson-4-blueprint.toml',
    expectedEntity: 'ExceptionRequest',
    protected: false,
  },
  {
    file: 'lesson-5-blueprint.toml',
    expectedEntity: 'ExceptionRequest',
    protected: true,
  },
  {
    file: 'lesson-6-blueprint.toml',
    expectedEntity: 'ExceptionRequest',
    expectedWorkflow: 'ApproveExceptionRequest',
    expectedCommand: 'ApproveExceptionRequestState',
    protected: true,
  },
  {
    file: 'lesson-7-blueprint.toml',
    expectedEntity: 'ExceptionRequest',
    expectedWorkflow: 'ApproveExceptionRequest',
    expectedCommand: 'ApproveExceptionRequestState',
    protected: true,
  },
  {
    file: 'lesson-8-blueprint.toml',
    expectedEntity: 'ExceptionRequest',
    expectedWorkflow: 'ApproveExceptionRequest',
    expectedCommand: 'ApproveExceptionRequestState',
    protected: true,
  },
]

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function fetchOk(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(5000),
  })
  return response
}

async function fetchJson(url) {
  const response = await fetchOk(url)
  assert(response.ok, `${url} returned ${response.status}`)
  return response.json()
}

async function waitFor(url) {
  let lastError
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetchOk(url)
      if (response.ok) return
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 100))
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

async function smokeCheckpoint(checkpoint, index) {
  const appPort = basePort + index * 2
  const adminPort = appPort + 30
  const blueprintPath = resolve(checkpointDir, checkpoint.file)
  const tempDir = await mkdtemp(join(tmpdir(), `zebric-${basename(checkpoint.file, '.toml')}-`))
  const parser = new BlueprintParser()
  let engine

  try {
    const content = await readFile(blueprintPath, 'utf8')
    const parsed = parser.parse(content, 'toml', blueprintPath)
    if (checkpoint.expectedCommand) {
      assert(
        parsed.commands?.some((command) => command.name === checkpoint.expectedCommand),
        `${checkpoint.file} missing command ${checkpoint.expectedCommand}`
      )
      const entity = parsed.entities.find((candidate) => candidate.name === checkpoint.expectedEntity)
      const status = entity?.fields.find((field) => field.name === 'status')
      assert(
        status?.write === 'command-only' && status.commands?.includes(checkpoint.expectedCommand),
        `${checkpoint.file} status is not protected by ${checkpoint.expectedCommand}`
      )
    }

    engine = new ZebricEngine({
      blueprintPath,
      host,
      port: appPort,
      dev: {
        adminHost: host,
        adminPort,
        dbPath: join(tempDir, 'app.db'),
        hotReload: false,
        seed: true,
        logLevel: 'error',
        logQueries: false,
        rateLimit: { max: 1000, windowMs: 1000 },
      },
    })

    await engine.start()
    await waitFor(`http://${host}:${adminPort}/health`)

    const health = await fetchJson(`http://${host}:${adminPort}/health`)
    assert(health.healthy === true, `${checkpoint.file} admin health is not healthy`)

    const entities = await fetchJson(`http://${host}:${adminPort}/entities`)
    assert(
      entities.some((entity) => entity.name === checkpoint.expectedEntity),
      `${checkpoint.file} missing entity ${checkpoint.expectedEntity}`
    )

    const pages = await fetchJson(`http://${host}:${adminPort}/pages`)
    assert(pages.some((page) => page.path === '/'), `${checkpoint.file} missing / page`)
    assert(
      pages.some((page) => page.path === '/requests/new'),
      `${checkpoint.file} missing /requests/new page`
    )

    if (checkpoint.expectedWorkflow) {
      const workflows = await fetchJson(`http://${host}:${adminPort}/workflows`)
      assert(
        workflows.workflows.some((workflow) => workflow.name === checkpoint.expectedWorkflow),
        `${checkpoint.file} missing workflow ${checkpoint.expectedWorkflow}`
      )
    }

    const home = await fetchOk(`http://${host}:${appPort}/`, { redirect: 'manual' })
    if (checkpoint.protected) {
      assert(
        [302, 303, 307, 308].includes(home.status),
        `${checkpoint.file} protected / should redirect, got ${home.status}`
      )
    } else {
      assert(home.ok, `${checkpoint.file} public / returned ${home.status}`)
    }

    // Sign-in pages exist only for blueprints that declare [auth]; public blueprints must not expose them.
    const signIn = await fetchOk(`http://${host}:${appPort}/auth/sign-in`, { redirect: 'manual' })
    if (parsed.auth) {
      assert(signIn.ok, `${checkpoint.file} declares [auth] but /auth/sign-in returned ${signIn.status}`)
    } else {
      assert(
        signIn.status === 404,
        `${checkpoint.file} is public but /auth/sign-in returned ${signIn.status} (expected 404)`
      )
    }
    assert(
      Boolean(parsed.auth) === checkpoint.protected,
      `${checkpoint.file} protected=${checkpoint.protected} does not match its [auth] section`
    )

    console.log(`ok ${checkpoint.file}`)
  } finally {
    if (engine) {
      await engine.stop().catch((error) => {
        console.warn(`warning: failed to stop ${checkpoint.file}:`, error)
      })
    }
    await rm(tempDir, { recursive: true, force: true })
  }
}

// The engine installs process-level exception handlers that shut down with exit code 0,
// so catch failures here and exit non-zero explicitly instead of letting them escape.
try {
  for (const [index, checkpoint] of checkpoints.entries()) {
    await smokeCheckpoint(checkpoint, index)
  }
  console.log(`all ${checkpoints.length} tutorial checkpoints passed`)
  process.exit(0)
} catch (error) {
  console.error(`tutorial checkpoint smoke test FAILED: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
