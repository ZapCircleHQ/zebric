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
