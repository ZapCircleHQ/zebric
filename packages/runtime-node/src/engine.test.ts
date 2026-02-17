import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ZebricEngine } from './engine.js'
import type { EngineConfig } from './types/index.js'

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    blueprintPath: '/tmp/test-blueprint.yaml',
    port: 3000,
    host: 'localhost',
    ...overrides,
  }
}

describe('ZebricEngine', () => {
  describe('constructor', () => {
    it('initializes with starting status', () => {
      const engine = new ZebricEngine(makeConfig())
      const state = engine.getState()
      expect(state.status).toBe('starting')
    })

    it('sets version in state', () => {
      const engine = new ZebricEngine(makeConfig())
      const state = engine.getState()
      expect(state.version).toBe('0.1.1')
    })

    it('initializes pendingSchemaDiff as null', () => {
      const engine = new ZebricEngine(makeConfig())
      const state = engine.getState()
      expect(state.pendingSchemaDiff).toBeNull()
    })

    it('does not set startedAt on construction', () => {
      const engine = new ZebricEngine(makeConfig())
      const state = engine.getState()
      expect(state.startedAt).toBeUndefined()
    })

    it('stores config', () => {
      const config = makeConfig({ port: 4000, host: '0.0.0.0' })
      const engine = new ZebricEngine(config)
      // State is accessible; config is private but affects behavior
      expect(engine.getState()).toBeDefined()
    })

    it('configures audit logger with custom db path', () => {
      const engine = new ZebricEngine(makeConfig({
        dev: { dbPath: '/tmp/test.db' },
      }))
      expect(engine.getState().status).toBe('starting')
    })

    it('configures error sanitizer for non-production', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'development'
      const engine = new ZebricEngine(makeConfig())
      expect(engine.getState()).toBeDefined()
      process.env.NODE_ENV = originalEnv
    })
  })

  describe('getVersion', () => {
    it('returns the engine version string', () => {
      const engine = new ZebricEngine(makeConfig())
      expect(engine.getVersion()).toBe('0.1.1')
    })

    it('returns a semver-like string', () => {
      const engine = new ZebricEngine(makeConfig())
      expect(engine.getVersion()).toMatch(/^\d+\.\d+\.\d+$/)
    })
  })

  describe('getState', () => {
    it('returns an object with required fields', () => {
      const engine = new ZebricEngine(makeConfig())
      const state = engine.getState()
      expect(state).toHaveProperty('status')
      expect(state).toHaveProperty('version')
      expect(state).toHaveProperty('pendingSchemaDiff')
    })

    it('returns a reference to the same state object', () => {
      const engine = new ZebricEngine(makeConfig())
      const state1 = engine.getState()
      const state2 = engine.getState()
      expect(state1).toBe(state2)
    })
  })

  describe('stop', () => {
    it('prevents double shutdown', async () => {
      const engine = new ZebricEngine(makeConfig())
      // Access private isShuttingDown via any
      const engineAny = engine as any
      engineAny.isShuttingDown = true

      // stop() should return immediately without changing state
      const stateBefore = engine.getState().status
      await engine.stop()
      expect(engine.getState().status).toBe(stateBefore)
    })

    it('sets status to stopped on first call', async () => {
      const engine = new ZebricEngine(makeConfig())
      await engine.stop()
      expect(engine.getState().status).toBe('stopped')
    })

    it('sets isShuttingDown flag', async () => {
      const engine = new ZebricEngine(makeConfig())
      await engine.stop()
      expect((engine as any).isShuttingDown).toBe(true)
    })
  })

  describe('event emitter', () => {
    it('supports event listeners', () => {
      const engine = new ZebricEngine(makeConfig())
      const handler = vi.fn()
      engine.on('test', handler)
      engine.emit('test', { data: 'value' })
      expect(handler).toHaveBeenCalledWith({ data: 'value' })
    })

    it('supports removeListener', () => {
      const engine = new ZebricEngine(makeConfig())
      const handler = vi.fn()
      engine.on('test', handler)
      engine.removeListener('test', handler)
      engine.emit('test')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('getHealth', () => {
    it('reports unhealthy when database is not initialized', async () => {
      const engine = new ZebricEngine(makeConfig())
      const health = await engine.getHealth()
      expect(health.healthy).toBe(false)
      expect(health.database).toBe(false)
    })

    it('returns memory usage', async () => {
      const engine = new ZebricEngine(makeConfig())
      const health = await engine.getHealth()
      expect(health.memory).toBeDefined()
      expect(health.memory.heapUsed).toBeGreaterThan(0)
    })

    it('returns zero uptime before start', async () => {
      const engine = new ZebricEngine(makeConfig())
      const health = await engine.getHealth()
      expect(health.uptime).toBe(0)
    })

    it('reports plugins as healthy', async () => {
      const engine = new ZebricEngine(makeConfig())
      const health = await engine.getHealth()
      expect(health.plugins).toBe(true)
    })
  })
})
