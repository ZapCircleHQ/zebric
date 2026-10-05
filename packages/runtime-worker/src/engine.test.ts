import { describe, it, expect, beforeEach } from 'vitest'
import { ZebricWorkersEngine, createWorkerHandler } from './engine.js'
import { MockD1Database, MockKVNamespace, MockR2Bucket } from './test-helpers/mocks.js'

describe('ZebricWorkersEngine', () => {
  let env: any
  let engine: ZebricWorkersEngine

  const simpleBlueprint = {
    version: '0.3.0',
    project: {
      name: 'test-app',
      version: '1.0.0',
      runtime: { min_version: '0.2.0' }
    },
    entities: [
      {
        name: 'post',
        fields: [
          { name: 'title', type: 'Text' as const, required: true }
        ]
      }
    ],
    pages: []
  }

  beforeEach(() => {
    env = {
      DB: new MockD1Database(),
      CACHE_KV: new MockKVNamespace(),
      FILES: new MockR2Bucket()
    }

    engine = new ZebricWorkersEngine({
      env,
      blueprint: simpleBlueprint
    })
  })

  describe('initialization', () => {
    it('should initialize with inline blueprint', () => {
      expect(engine).toBeDefined()
      expect(engine.getCache()).toBeDefined()
      expect(engine.getStorage()).toBeDefined()
    })

    it('should throw error without blueprint', () => {
      expect(() => {
        new ZebricWorkersEngine({ env: {} })
      }).toThrow('Blueprint must be provided')
    })

    it('accepts D1-batch-eligible transactional workflows', () => {
      expect(() => new ZebricWorkersEngine({
        env,
        blueprint: {
          ...simpleBlueprint,
          workflows: [{
            name: 'AtomicUpdate',
            trigger: { manual: true },
            transactional: true,
            steps: [{ type: 'query', entity: 'post', action: 'update' }],
          }],
        } as any,
      })).not.toThrow()
    })

    it('rejects non-transactional workflows until Workers has a workflow executor', () => {
      expect(() => new ZebricWorkersEngine({
        env,
        blueprint: {
          ...simpleBlueprint,
          workflows: [{
            name: 'NotifyAuthor',
            trigger: { manual: true },
            steps: [{ type: 'query', entity: 'post', action: 'update' }],
          }],
        } as any,
      })).toThrow('workflow must declare transactional = true')
    })
  })

  describe('health check', () => {
    it('should respond to health check', async () => {
      const request = new Request('https://example.com/health')
      const response = await engine.fetch(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('x-request-id')).toBeTruthy()
      const data = await response.json()
      expect(data.status).toBe('healthy')
    })
  })

  describe('API requests', () => {
    it('should return 404 when no entities are defined', async () => {
      const request = new Request('https://example.com/api/post')
      const response = await engine.fetch(request)
      expect(response.status).toBe(404)
    })
  })

  describe('page requests', () => {
    it('should return 404 when no pages exist', async () => {
      const request = new Request('https://example.com/')
      const response = await engine.fetch(request)

      expect(response.status).toBe(404)
    })

    it('renders file-backed templates bundled with the Worker', async () => {
      const templateEngine = new ZebricWorkersEngine({
        env,
        blueprint: {
          ...simpleBlueprint,
          pages: [{
            path: '/',
            title: 'Bundled page',
            auth: 'none',
            template: { type: 'file', source: 'templates/page.liquid' },
          }],
        } as any,
        templates: {
          'templates/page.liquid': '<main data-runtime="worker">{{ page.title }}</main>',
        },
      })

      const response = await templateEngine.fetch(new Request('https://example.com/'))
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<main data-runtime="worker">Bundled page</main>')
    })

    it('preloads file-backed templates from KV before rendering', async () => {
      const templates = new MockKVNamespace()
      await templates.put('template:templates/page.liquid', '<main>KV: {{ page.title }}</main>')
      const templateEngine = new ZebricWorkersEngine({
        env: { ...env, TEMPLATES_KV: templates },
        blueprint: {
          ...simpleBlueprint,
          pages: [{
            path: '/',
            title: 'Edge page',
            auth: 'none',
            template: { type: 'file', source: 'templates/page.liquid' },
          }],
        } as any,
      })

      const response = await templateEngine.fetch(new Request('https://example.com/'))
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<main>KV: Edge page</main>')
    })
  })

  describe('authentication', () => {
    const authenticatedBlueprint: any = {
      ...simpleBlueprint,
      auth: { providers: ['email'] },
      pages: [{ path: '/', title: 'Private', layout: 'dashboard' }],
    }

    it('initializes Better Auth on D1 by default for authenticated Blueprints', async () => {
      const authEngine = new ZebricWorkersEngine({
        env: {
          ...env,
          BETTER_AUTH_URL: 'http://localhost:8787',
          BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
        },
        blueprint: authenticatedBlueprint,
      })

      const response = await authEngine.fetch(new Request('http://localhost:8787/auth/sign-in'))
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('Sign in to continue')
      expect(authEngine.getAuthProvider()).toBeDefined()
    })

    it('requires an explicit auth secret for HTTPS deployments', () => {
      expect(() => new ZebricWorkersEngine({
        env: { ...env, BETTER_AUTH_URL: 'https://app.example.com' },
        blueprint: authenticatedBlueprint,
      })).toThrow('BETTER_AUTH_SECRET is required')
    })

    it('uses an injected auth provider for protected pages', async () => {
      const authProvider = {
        getAuthInstance: () => ({ handler: () => Response.json({ ok: true }) }),
        getSession: async () => ({
          id: 'session-1',
          userId: 'user-1',
          user: { id: 'user-1', email: 'edge@example.com' },
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
        hasRole: () => false,
        ownsResource: () => false,
      }
      const authEngine = new ZebricWorkersEngine({ env, blueprint: authenticatedBlueprint, authProvider })

      const response = await authEngine.fetch(new Request('https://example.com/'))
      expect(response.status).toBe(200)
      expect(authEngine.getAuthProvider()).toBe(authProvider)
    })

    it('mounts the provider handler at the Node-compatible auth API path', async () => {
      const authProvider = {
        getAuthInstance: () => ({ handler: () => Response.json({ runtime: 'worker' }) }),
        getSession: async () => null,
        hasRole: () => false,
        ownsResource: () => false,
      }
      const authEngine = new ZebricWorkersEngine({ env, blueprint: authenticatedBlueprint, authProvider })

      const response = await authEngine.fetch(new Request('https://example.com/api/auth/session'))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ runtime: 'worker' })
    })

    it('issues and validates CSRF tokens for cookie-authenticated mutations', async () => {
      const authProvider = {
        getAuthInstance: () => ({ handler: () => Response.json({ signedIn: true }) }),
        getSession: async () => null,
        hasRole: () => false,
        ownsResource: () => false,
      }
      const authEngine = new ZebricWorkersEngine({ env, blueprint: authenticatedBlueprint, authProvider })
      const pageResponse = await authEngine.fetch(new Request('https://app.example.com/auth/sign-in'))
      const cookie = pageResponse.headers.get('set-cookie')!
      const token = /csrf-token=([^;]+)/.exec(cookie)?.[1]
      expect(token).toBeTruthy()

      const rejected = await authEngine.fetch(new Request('https://app.example.com/api/auth/sign-in/email', {
        method: 'POST',
        headers: { cookie },
      }))
      expect(rejected.status).toBe(403)

      const accepted = await authEngine.fetch(new Request('https://app.example.com/api/auth/sign-in/email', {
        method: 'POST',
        headers: { cookie, 'x-csrf-token': token! },
      }))
      expect(accepted.status).toBe(200)
    })

    it('renders sign-in pages and keeps callback redirects on the request origin', async () => {
      const authProvider = {
        getAuthInstance: () => ({ handler: () => new Response(null, { status: 204 }) }),
        getSession: async () => null,
        hasRole: () => false,
        ownsResource: () => false,
      }
      const authEngine = new ZebricWorkersEngine({ env, blueprint: authenticatedBlueprint, authProvider })

      const response = await authEngine.fetch(new Request(
        'https://app.example.com/auth/sign-in?callback=https://evil.example/steal?token=1'
      ))
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(html).toContain('https://app.example.com/steal?token=1')
      expect(html).not.toContain('https://evil.example')
    })
  })

  describe('entity API parity', () => {
    const apiBlueprint: any = {
      version: '0.3.0',
      project: { name: 'worker-api', version: '1.0.0', runtime: { min_version: '0.2.0' } },
      entities: [{
        name: 'Item',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'title', type: 'Text', required: true },
          { name: 'createdAt', type: 'DateTime' },
        ],
      }],
      pages: [],
      auth: {
        providers: [],
        permissions: { operator: { allow: ['Item.*'] } },
        apiKeys: [{
          name: 'worker-agent',
          keyEnv: 'WORKER_AGENT_KEY',
          roles: ['operator'],
          scopes: [
            'entity.item.list',
            'entity.item.get',
            'entity.item.create',
            'entity.item.update',
            'entity.item.delete',
          ],
        }],
      },
    }

    const noSessionProvider = {
      getAuthInstance: () => ({ handler: () => new Response(null, { status: 204 }) }),
      getSession: async () => null,
      hasRole: () => false,
      ownsResource: () => false,
    }

    async function createApiEngine(scopes?: string[]) {
      const db = new MockD1Database()
      const blueprint = scopes
        ? {
            ...apiBlueprint,
            auth: {
              ...apiBlueprint.auth,
              apiKeys: [{ ...apiBlueprint.auth.apiKeys[0], scopes }],
            },
          }
        : apiBlueprint
      const apiEngine = new ZebricWorkersEngine({
        env: { DB: db, WORKER_AGENT_KEY: 'worker-secret' } as any,
        blueprint,
        authProvider: noSessionProvider,
      })
      await apiEngine.getDatabase().migrate([
        'CREATE TABLE Item (id TEXT PRIMARY KEY, title TEXT NOT NULL, createdAt TEXT)',
      ])
      return apiEngine
    }

    it('supports scoped API-key CRUD with Node-compatible entity paths', async () => {
      const apiEngine = await createApiEngine()
      const agentHeaders = {
        authorization: 'Bearer worker-secret',
        'content-type': 'application/json',
        'x-agent-run-id': 'worker-run-1',
      }

      const created = await apiEngine.fetch(new Request('https://example.com/api/items', {
        method: 'POST',
        headers: agentHeaders,
        body: JSON.stringify({ id: 'item-1', title: 'Created at the edge', createdAt: '2026-10-05T00:00:00Z' }),
      }))
      expect(created.status).toBe(201)

      const listed = await apiEngine.fetch(new Request('https://example.com/api/items', {
        headers: { authorization: 'Bearer worker-secret' },
      }))
      expect(listed.status).toBe(200)
      expect(await listed.json()).toEqual([expect.objectContaining({ id: 'item-1', title: 'Created at the edge' })])

      const updated = await apiEngine.fetch(new Request('https://example.com/api/items/item-1', {
        method: 'PUT',
        headers: agentHeaders,
        body: JSON.stringify({ title: 'Updated at the edge' }),
      }))
      expect(updated.status).toBe(200)
      expect(await updated.json()).toEqual(expect.objectContaining({ title: 'Updated at the edge' }))

      const deleted = await apiEngine.fetch(new Request('https://example.com/api/items/item-1', {
        method: 'DELETE',
        headers: agentHeaders,
      }))
      expect(deleted.status).toBe(200)
    })

    it('enforces scopes, agent attribution, and CSRF bypass only for valid keys', async () => {
      const apiEngine = await createApiEngine(['entity.item.list'])

      const unscoped = await apiEngine.fetch(new Request('https://example.com/api/items', {
        method: 'POST',
        headers: {
          authorization: 'Bearer worker-secret',
          'content-type': 'application/json',
          'x-agent-run-id': 'worker-run-1',
        },
        body: JSON.stringify({ id: 'item-1', title: 'Denied' }),
      }))
      expect(unscoped.status).toBe(403)

      const missingRun = await (await createApiEngine()).fetch(new Request('https://example.com/api/items', {
        method: 'POST',
        headers: { authorization: 'Bearer worker-secret', 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'item-1', title: 'No attribution' }),
      }))
      expect(missingRun.status).toBe(400)

      const invalidKey = await apiEngine.fetch(new Request('https://example.com/api/items', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-secret', 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'item-1', title: 'No CSRF bypass' }),
      }))
      expect(invalidKey.status).toBe(403)
      expect(await invalidKey.json()).toEqual({ error: 'Invalid CSRF token' })
    })
  })

  describe('commands and D1 workflows', () => {
    const executionBlueprint: any = {
      version: '0.6.0',
      project: { name: 'worker-execution', version: '1.0.0', runtime: { min_version: '0.6.0' } },
      entities: [{
        name: 'Task',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'status', type: 'Text', write: 'command-only', commands: ['ApproveTask'] },
          { name: 'note', type: 'Text' },
        ],
      }],
      pages: [],
      commands: [{
        name: 'ApproveTask',
        entity: 'Task',
        scopes: ['command.task.approve'],
        input: { note: { type: 'Text', required: true } },
        mutations: { status: 'approved', note: 'input.note' },
      }],
      workflows: [{
        name: 'MovePair',
        trigger: { manual: true },
        transactional: true,
        steps: [
          { type: 'query', entity: 'Task', action: 'update', where: { id: '{{variables.data.params.id}}' }, data: { note: '{{variables.data.body.note}}' } },
          { type: 'query', entity: 'Task', action: 'update', where: { id: '{{variables.data.body.otherId}}' }, data: { note: '{{variables.data.body.note}}' } },
        ],
      }],
      skills: [{
        name: 'task_workflows',
        actions: [{
          name: 'move_pair', method: 'POST', path: '/api/tasks/{id}/move-pair', entity: 'Task',
          workflow: 'MovePair', scopes: ['workflow.task.move'], body: { otherId: 'Text', note: 'Text' },
        }],
      }],
      auth: {
        providers: [],
        permissions: { operator: { allow: ['Task.*'] } },
        apiKeys: [{
          name: 'agent', keyEnv: 'AGENT_KEY', roles: ['operator'],
          scopes: ['command.task.approve', 'workflow.task.move'],
        }],
      },
    }

    async function executionEngine() {
      const instance = new ZebricWorkersEngine({
        env: { DB: new MockD1Database(), AGENT_KEY: 'secret' } as any,
        blueprint: executionBlueprint,
        authProvider: {
          getAuthInstance: () => ({ handler: () => new Response(null, { status: 204 }) }),
          getSession: async () => null,
          hasRole: () => false,
          ownsResource: () => false,
        },
      })
      await instance.getDatabase().migrate(['CREATE TABLE Task (id TEXT PRIMARY KEY, status TEXT, note TEXT)'])
      await instance.getDatabase().query('INSERT INTO Task VALUES (?, ?, ?)', ['task-1', 'ready', null])
      await instance.getDatabase().query('INSERT INTO Task VALUES (?, ?, ?)', ['task-2', 'ready', null])
      return instance
    }

    it('executes declarative commands and rejects conflicting idempotency-key reuse', async () => {
      const instance = await executionEngine()
      const headers = {
        authorization: 'Bearer secret', 'content-type': 'application/json',
        'x-agent-run-id': 'run-1', 'idempotency-key': 'approve-1',
      }
      const first = await instance.fetch(new Request('https://example.com/api/commands/approve_task/task-1', {
        method: 'POST', headers, body: JSON.stringify({ note: 'checked' }),
      }))
      expect(first.status).toBe(200)
      expect(await first.json()).toEqual(expect.objectContaining({ record: expect.objectContaining({ status: 'approved', note: 'checked' }) }))

      const replay = await instance.fetch(new Request('https://example.com/api/commands/approve_task/task-1', {
        method: 'POST', headers, body: JSON.stringify({ note: 'checked' }),
      }))
      expect(replay.status).toBe(200)

      const conflict = await instance.fetch(new Request('https://example.com/api/commands/approve_task/task-1', {
        method: 'POST', headers, body: JSON.stringify({ note: 'different' }),
      }))
      expect(conflict.status).toBe(409)
    })

    it('runs eligible workflow mutations in a job and limits job reads to the owner', async () => {
      const instance = await executionEngine()
      const response = await instance.fetch(new Request('https://example.com/api/tasks/task-1/move-pair', {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json', 'x-agent-run-id': 'run-2' },
        body: JSON.stringify({ otherId: 'task-2', note: 'moved' }),
      }))
      expect(response.status).toBe(202)
      const invocation = await response.json() as any

      const job = await instance.fetch(new Request(`https://example.com${invocation.job.url}`, {
        headers: { authorization: 'Bearer secret' },
      }))
      expect(job.status).toBe(200)
      expect(await job.json()).toEqual(expect.objectContaining({ status: 'succeeded', workflow: 'MovePair' }))

      const rows = await instance.getDatabase().query<any>('SELECT id, note FROM Task ORDER BY id')
      expect(rows.rows).toEqual([{ id: 'task-1', note: 'moved' }, { id: 'task-2', note: 'moved' }])
    })

    it('rejects workflow shapes D1 cannot execute atomically', () => {
      expect(() => new ZebricWorkersEngine({
        env: { DB: new MockD1Database() } as any,
        blueprint: {
          ...executionBlueprint,
          workflows: [{
            name: 'ExternalEffect', trigger: { manual: true }, transactional: true,
            steps: [{ type: 'webhook', url: 'https://example.com' }],
          }],
          skills: [],
        },
      })).toThrow('non-database effect "webhook"')
    })
  })

  describe('error handling', () => {
    it('should handle malformed requests gracefully', async () => {
      const request = new Request('https://example.com/api/post', {
        method: 'POST',
        body: 'invalid json',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await engine.fetch(request)
      expect(response.status).toBeGreaterThanOrEqual(400)
    })
  })

  describe('widget routes', () => {
    const widgetBlueprint: any = {
      version: '0.3.0',
      project: { name: 'widget-worker', version: '1.0.0', runtime: { min_version: '0.2.0' } },
      entities: [
        {
          name: 'Issue',
          fields: [
            { name: 'id', type: 'ULID', primary_key: true },
            { name: 'title', type: 'Text', required: true },
            { name: 'columnId', type: 'Text' },
            { name: 'position', type: 'Integer' },
            { name: 'important', type: 'Boolean' },
          ],
        },
        {
          name: 'Column',
          fields: [
            { name: 'id', type: 'ULID', primary_key: true },
            { name: 'name', type: 'Text', required: true },
            { name: 'position', type: 'Integer' },
          ],
        },
        {
          name: 'Customer',
          fields: [
            { name: 'id', type: 'ULID', primary_key: true },
            { name: 'firstName', type: 'Text' },
            { name: 'lastName', type: 'Text' },
          ],
        },
      ],
      pages: [
        {
          path: '/',
          title: 'Board',
          widget: {
            kind: 'board',
            entity: 'Issue',
            group_by: 'columnId',
            column_entity: 'Column',
            on_toggle: { update: { '$field': '!$row.$field' } },
            on_move: { update: { columnId: '$to.id', position: '$index' } },
          },
        },
        {
          path: '/people',
          title: 'Search',
          widget: {
            kind: 'lookup',
            entity: 'Customer',
            search: ['lastName', 'firstName'],
            display: '{lastName}, {firstName}',
          },
        },
      ],
    }

    it('handles a widget toggle event', async () => {
      const widgetEngine = new ZebricWorkersEngine({
        env: { DB: new MockD1Database() } as any,
        blueprint: widgetBlueprint,
      })
      const db = widgetEngine.getDatabase()
      await db.migrate([
        'CREATE TABLE Issue (id TEXT PRIMARY KEY, title TEXT, columnId TEXT, position INTEGER, important INTEGER)',
        'CREATE TABLE "Column" (id TEXT PRIMARY KEY, name TEXT, position INTEGER)',
        'CREATE TABLE Customer (id TEXT PRIMARY KEY, firstName TEXT, lastName TEXT)',
      ])
      await db.query('INSERT INTO Issue (id, title, important) VALUES (?, ?, ?)', ['iss-1', 'Wire it up', 0])

      const response = await widgetEngine.fetch(new Request('https://example.com/_widget/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: '/',
          event: 'toggle',
          row: { entity: 'Issue', id: 'iss-1' },
          ctx: { field: 'important' },
        }),
      }))

      expect(response.status).toBe(200)
      const result = await response.json() as any
      expect(result.success).toBe(true)
      expect(result.record.important).toBeTruthy()
    })

    it('handles a widget move event', async () => {
      const widgetEngine = new ZebricWorkersEngine({
        env: { DB: new MockD1Database() } as any,
        blueprint: widgetBlueprint,
      })
      const db = widgetEngine.getDatabase()
      await db.migrate([
        'CREATE TABLE Issue (id TEXT PRIMARY KEY, title TEXT, columnId TEXT, position INTEGER, important INTEGER)',
        'CREATE TABLE "Column" (id TEXT PRIMARY KEY, name TEXT, position INTEGER)',
        'CREATE TABLE Customer (id TEXT PRIMARY KEY, firstName TEXT, lastName TEXT)',
      ])
      await db.query('INSERT INTO Issue (id, title, columnId, position) VALUES (?, ?, ?, ?)', ['iss-1', 'Ship it', 'col-a', 0])

      const response = await widgetEngine.fetch(new Request('https://example.com/_widget/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: '/',
          event: 'move',
          row: { entity: 'Issue', id: 'iss-1' },
          ctx: { to: { id: 'col-b' }, index: 3 },
        }),
      }))

      expect(response.status).toBe(200)
      const result = await response.json() as any
      expect(result.record.columnId).toBe('col-b')
      expect(result.record.position).toBe(3)
    })

    it('handles lookup search across multiple fields', async () => {
      const widgetEngine = new ZebricWorkersEngine({
        env: { DB: new MockD1Database() } as any,
        blueprint: widgetBlueprint,
      })
      const db = widgetEngine.getDatabase()
      await db.migrate([
        'CREATE TABLE Issue (id TEXT PRIMARY KEY, title TEXT, columnId TEXT, position INTEGER, important INTEGER)',
        'CREATE TABLE "Column" (id TEXT PRIMARY KEY, name TEXT, position INTEGER)',
        'CREATE TABLE Customer (id TEXT PRIMARY KEY, firstName TEXT, lastName TEXT)',
      ])
      await db.query('INSERT INTO Customer VALUES (?, ?, ?)', ['c1', 'Sarah', 'Chen'])
      await db.query('INSERT INTO Customer VALUES (?, ?, ?)', ['c2', 'James', 'Smith'])
      await db.query('INSERT INTO Customer VALUES (?, ?, ?)', ['c3', 'Mei', 'Smith'])

      const response = await widgetEngine.fetch(new Request('https://example.com/_widget/search?page=/people&q=smi'))
      expect(response.status).toBe(200)
      const result = await response.json() as any
      expect(result.results).toHaveLength(2)
      expect(result.results.map((r: any) => r.label).sort()).toEqual(['Smith, James', 'Smith, Mei'])
    })

    it('returns 400 for unknown widget event', async () => {
      const widgetEngine = new ZebricWorkersEngine({
        env: { DB: new MockD1Database() } as any,
        blueprint: widgetBlueprint,
      })
      const response = await widgetEngine.fetch(new Request('https://example.com/_widget/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: '/',
          event: 'nuke_everything',
          row: { entity: 'Issue', id: 'iss-1' },
          ctx: {},
        }),
      }))
      expect(response.status).toBe(400)
    })

    it('404 for search on a page without lookup', async () => {
      const widgetEngine = new ZebricWorkersEngine({
        env: { DB: new MockD1Database() } as any,
        blueprint: widgetBlueprint,
      })
      const response = await widgetEngine.fetch(new Request('https://example.com/_widget/search?page=/&q=x'))
      expect(response.status).toBe(404)
    })
  })
})

describe('createWorkerHandler', () => {
  const simpleBlueprint = {
    version: '0.3.0',
    project: {
      name: 'test-app',
      version: '1.0.0',
      runtime: { min_version: '0.2.0' }
    },
    entities: [
      {
        name: 'user',
        fields: [
          { name: 'name', type: 'Text' as const, required: true }
        ]
      }
    ],
    pages: []
  }

  it('should create worker handler function', () => {
    const handler = createWorkerHandler({
      blueprint: simpleBlueprint
    })

    expect(handler).toBeDefined()
    expect(handler.fetch).toBeDefined()
    expect(typeof handler.fetch).toBe('function')
  })

  it('should handle requests through created handler', async () => {
    const handler = createWorkerHandler({
      blueprint: simpleBlueprint
    })

    const env = {
      DB: new MockD1Database(),
      CACHE: new MockKVNamespace()
    }

    const request = new Request('https://example.com/health')
    const response = await handler.fetch(request, env, {} as any)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.status).toBe('healthy')
  })

  it('should work with pre-parsed blueprint', () => {
    const blueprint = {
      version: '0.3.0',
      project: {
        name: 'test-app',
        version: '1.0.0',
        runtime: { min_version: '0.2.0' }
      },
      entities: [
        {
          name: 'user',
          fields: [
            { name: 'name', type: 'Text' as const, required: true }
          ]
        }
      ],
      pages: []
    }

    const handler = createWorkerHandler({
      blueprint
    })

    expect(handler).toBeDefined()
  })
})
