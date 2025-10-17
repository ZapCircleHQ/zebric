import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createTestHarness } from '../helpers/index.js'
import type { Blueprint } from '../../src/types/index.js'
import type { PluginAuthToken } from '../../src/types/plugin.js'

const BASE_BLUEPRINT: Blueprint = {
  version: '0.1.0',
  project: {
    name: 'RuntimeTestApp',
    version: '1.0.0',
    runtime: { min_version: '0.1.0' },
  },
  entities: [
    {
      name: 'Post',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true },
        { name: 'title', type: 'Text', required: true },
      ],
    },
  ],
  pages: [],
  auth: {
    providers: ['email'],
  },
}

describe('ZBL Runtime Engine integration', () => {
  const harness = createTestHarness()

  afterEach(async () => {
    await harness.cleanup()
  })

  it('exposes health and metrics endpoints', async () => {
    await harness.createTempDir()
    const blueprintPath = await harness.writeBlueprint(BASE_BLUEPRINT)

    // Start engine with custom config for integration tests
    const port = await harness.getAvailablePort()
    const tempDir = harness.getTempDir()

    // Need to manually initialize engine with custom options
    const { ZebricEngine } = await import('../../src/engine.js')
    const testEngine = new ZebricEngine({
      blueprintPath,
      port,
      host: '127.0.0.1',
      dev: {
        hotReload: false,
        logLevel: 'error',
        logQueries: false,
        dbPath: join(tempDir, 'app.db'),
        adminPort: 0, // Use random port to avoid conflicts
      },
    })

    await testEngine.start()

    // Give Fastify a brief moment to settle
    await delay(25)

    try {
      const healthResponse = await fetch(`http://127.0.0.1:${port}/health`)
      expect(healthResponse.status).toBe(200)
      const health = (await healthResponse.json()) as any
      expect(health.healthy).toBe(true)
      expect(health.database).toBe(true)

      // Check metrics endpoint exists
      const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`)
      expect(metricsResponse.status).toBe(200)
      const metricsText = await metricsResponse.text()
      // Metrics may be empty initially
      expect(metricsText).toBeDefined()
    } finally {
      await testEngine.stop()
    }
  })

  it('applies additive schema changes during hot reload', async () => {
    await harness.createTempDir()

    const initialBlueprint: Blueprint = {
      ...BASE_BLUEPRINT,
      entities: [
        {
          name: 'Post',
          fields: [
            { name: 'id', type: 'ULID', primary_key: true },
            { name: 'title', type: 'Text', required: true },
          ],
        },
      ],
    }

    const blueprintPath = await harness.writeBlueprint(initialBlueprint)
    const port = await harness.getAvailablePort()
    const tempDir = harness.getTempDir()

    const { ZebricEngine } = await import('../../src/engine.js')
    const engine = new ZebricEngine({
      blueprintPath,
      port,
      host: '127.0.0.1',
      dev: {
        hotReload: false,
        logLevel: 'error',
        logQueries: false,
        dbPath: join(tempDir, 'app.db'),
        adminPort: 0, // Use random port to avoid conflicts
      },
    })

    await engine.start()
    await delay(25)

    try {
      // Create an initial record without summary field
      const createResponse = await fetch(`http://127.0.0.1:${port}/api/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Initial Post',
        }),
      })
      expect(createResponse.status).toBe(201)

      // Update blueprint to add new nullable summary field
      const reloadedBlueprint: Blueprint = {
        ...initialBlueprint,
        entities: [
          {
            name: 'Post',
            fields: [
              { name: 'id', type: 'ULID', primary_key: true },
              { name: 'title', type: 'Text', required: true },
              { name: 'summary', type: 'Text', nullable: true },
            ],
          },
        ],
      }
      writeFileSync(blueprintPath, JSON.stringify(reloadedBlueprint, null, 2), 'utf-8')

      await engine.reload()
      expect(engine.getState().pendingSchemaDiff).toBeNull()

      // Create a record with the new summary field
      const createWithSummary = await fetch(`http://127.0.0.1:${port}/api/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Post With Summary',
          summary: 'Runtime schema reload works!',
        }),
      })
      expect(createWithSummary.status).toBe(201)
      const created = (await createWithSummary.json()) as any

      const readResponse = await fetch(`http://127.0.0.1:${port}/api/posts/${created.id}`)
      expect(readResponse.status).toBe(200)
      const fetched = (await readResponse.json()) as any
      expect(fetched.summary).toBe('Runtime schema reload works!')
    } finally {
      await engine.stop()
    }
  })

  it('issues and revokes Better Auth backed plugin tokens', async () => {
    await harness.createTempDir()
    const blueprintPath = await harness.writeBlueprint(BASE_BLUEPRINT)
    const port = await harness.getAvailablePort()
    const tempDir = harness.getTempDir()

    const { ZebricEngine } = await import('../../src/engine.js')
    const engine = new ZebricEngine({
      blueprintPath,
      port,
      host: '127.0.0.1',
      dev: {
        hotReload: false,
        logLevel: 'error',
        logQueries: false,
        dbPath: join(tempDir, 'app.db'),
        adminPort: 0, // Use random port to avoid conflicts
      },
    })

    await engine.start()
    await delay(25)

    try {
      const signupResponse = await fetch(`http://127.0.0.1:${port}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Plugin Test User',
          email: 'plugin-test@example.com',
          password: 'strongPassword123!',
        }),
      })
      expect(signupResponse.status).toBe(200)
      const signupPayload = (await signupResponse.json()) as any
      const userId: string = signupPayload.user.id

      const engineAPI = (engine as any).getEngineAPI()

      const token: PluginAuthToken = await engineAPI.auth.createSession(userId)
      expect(token.userId).toBe(userId)
      expect(token.token).toHaveLength(32)

      const currentUser = await engineAPI.auth.getCurrentUser({
        headers: {
          authorization: `Bearer ${token.token}`,
        },
        cookies: {},
      })
      expect(currentUser?.id).toBe(userId)

      await engineAPI.auth.invalidateSession(token.token)

      const afterInvalidation = await engineAPI.auth.getCurrentUser({
        headers: {
          authorization: `Bearer ${token.token}`,
        },
        cookies: {},
      })
      expect(afterInvalidation).toBeNull()
    } finally {
      await engine.stop()
    }
  })
})
