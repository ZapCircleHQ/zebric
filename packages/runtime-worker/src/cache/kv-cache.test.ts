import { describe, it, expect, beforeEach } from 'vitest'
import { KVCache } from './kv-cache.js'
import { MockKVNamespace } from '../test-helpers/mocks.js'

describe('KVCache', () => {
  let kv: MockKVNamespace
  let cache: KVCache

  beforeEach(() => {
    kv = new MockKVNamespace()
    cache = new KVCache(kv as any, 'test:')
  })

  describe('get', () => {
    it('should get value from cache', async () => {
      await kv.put('test:mykey', JSON.stringify({ foo: 'bar' }))

      const value = await cache.get<{ foo: string }>('mykey')

      expect(value).toEqual({ foo: 'bar' })
    })

    it('should return null for non-existent key', async () => {
      const value = await cache.get('nonexistent')

      expect(value).toBeNull()
    })

    it('should handle errors gracefully', async () => {
      const brokenKV = {
        get: () => {
          throw new Error('KV error')
        }
      } as any

      const brokenCache = new KVCache(brokenKV)
      const value = await brokenCache.get('key')

      expect(value).toBeNull()
    })
  })

  describe('set', () => {
    it('should set value in cache', async () => {
      await cache.set('mykey', { foo: 'bar' })

      const stored = await kv.get('test:mykey', { type: 'json' })
      expect(stored).toEqual({ foo: 'bar' })
    })

    it('should set value with TTL', async () => {
      await cache.set('mykey', 'value', 5000) // 5 seconds in ms

      const entry = (kv as any).data.get('test:mykey')
      expect(entry).toBeDefined()
      // TTL should be converted from ms to seconds
    })

    it('should throw error on set failure', async () => {
      const brokenKV = {
        put: () => {
          throw new Error('KV put failed')
        }
      } as any

      const brokenCache = new KVCache(brokenKV)

      await expect(
        brokenCache.set('key', 'value')
      ).rejects.toThrow('Failed to set cache key')
    })
  })

  describe('delete', () => {
    it('should delete key from cache', async () => {
      await cache.set('mykey', 'value')
      await cache.delete('mykey')

      const value = await cache.get('mykey')
      expect(value).toBeNull()
    })

    it('should handle delete errors gracefully', async () => {
      const brokenKV = {
        delete: () => {
          throw new Error('Delete failed')
        }
      } as any

      const brokenCache = new KVCache(brokenKV)

      await expect(brokenCache.delete('key')).resolves.toBeUndefined()
    })
  })

  describe('clear', () => {
    it('should log warning about unsupported operation', async () => {
      // clear() doesn't actually do anything in KV
      await expect(cache.clear()).resolves.toBeUndefined()
    })
  })

  describe('has', () => {
    it('should return true for existing key', async () => {
      await cache.set('mykey', 'value')

      const exists = await cache.has('mykey')
      expect(exists).toBe(true)
    })

    it('should return false for non-existent key', async () => {
      const exists = await cache.has('nonexistent')
      expect(exists).toBe(false)
    })
  })

  describe('incr', () => {
    it('should increment counter from 0', async () => {
      const value = await cache.incr('counter')
      expect(value).toBe(1)
    })

    it('should increment existing counter', async () => {
      await cache.set('counter', 5)

      const value = await cache.incr('counter')
      expect(value).toBe(6)
    })

    it('should increment by custom delta', async () => {
      await cache.set('counter', 10)

      const value = await cache.incr('counter', 5)
      expect(value).toBe(15)
    })
  })

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await cache.set('mykey', 'value')

      const exists = await cache.exists('mykey')
      expect(exists).toBe(true)
    })

    it('should return false for non-existent key', async () => {
      const exists = await cache.exists('nonexistent')
      expect(exists).toBe(false)
    })
  })

  describe('close', () => {
    it('should close without errors', async () => {
      await expect(cache.close()).resolves.toBeUndefined()
    })
  })

  describe('key prefix', () => {
    it('should use custom prefix', async () => {
      const customCache = new KVCache(kv as any, 'custom:')
      await customCache.set('key', 'value')

      const stored = await kv.get('custom:key')
      expect(stored).toBe(JSON.stringify('value'))
    })

    it('should use default prefix', async () => {
      const defaultCache = new KVCache(kv as any)
      await defaultCache.set('key', 'value')

      const stored = await kv.get('cache:key')
      expect(stored).toBe(JSON.stringify('value'))
    })
  })
})
