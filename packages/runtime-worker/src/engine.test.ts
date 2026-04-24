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
      CACHE: new MockKVNamespace(),
      STORAGE: new MockR2Bucket()
    }

    engine = new ZebricWorkersEngine({
      env,
      blueprint: simpleBlueprint
    })
  })

  describe('initialization', () => {
    it('should initialize with inline blueprint', () => {
      expect(engine).toBeDefined()
    })

    it('should throw error without blueprint', () => {
      expect(() => {
        new ZebricWorkersEngine({ env: {} })
      }).toThrow('Blueprint must be provided')
    })
  })

  describe('health check', () => {
    it('should respond to health check', async () => {
      const request = new Request('https://example.com/health')
      const response = await engine.fetch(request)

      expect(response.status).toBe(200)
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
