/**
 * KV Cache Adapter
 *
 * Implements cache using CloudFlare KV storage.
 */

import type { CacheInterface } from '@zebric/runtime-core'

export class KVCache implements CacheInterface {
  constructor(private kv: KVNamespace, private keyPrefix: string = 'cache:') {}

  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const fullKey = this.keyPrefix + key
      const value = await this.kv.get(fullKey, { type: 'json' })
      return value as T | null
    } catch (error) {
      console.error(`KV cache get error for key ${key}:`, error)
      return null
    }
  }

  async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const fullKey = this.keyPrefix + key
      const options: KVNamespacePutOptions = {}

      if (ttl !== undefined) {
        // TTL in KV is in seconds
        options.expirationTtl = Math.floor(ttl / 1000)
      }

      await this.kv.put(fullKey, JSON.stringify(value), options)
    } catch (error) {
      console.error(`KV cache set error for key ${key}:`, error)
      throw new Error(`Failed to set cache key ${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const fullKey = this.keyPrefix + key
      await this.kv.delete(fullKey)
    } catch (error) {
      console.error(`KV cache delete error for key ${key}:`, error)
    }
  }

  async clear(): Promise<void> {
    // KV doesn't have a clear all operation
    // We would need to list and delete keys with our prefix
    // This is expensive, so we skip it for now
    console.warn('KV cache clear() is not implemented - KV does not support bulk delete')
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== null
  }

  async incr(key: string, delta: number = 1): Promise<number> {
    // KV doesn't have atomic increment, so we do get + set
    // This is not atomic and should only be used for non-critical counters
    const current = await this.get<number>(key) || 0
    const newValue = current + delta
    await this.set(key, newValue)
    return newValue
  }

  async exists(key: string): Promise<boolean> {
    return this.has(key)
  }

  async close(): Promise<void> {
    // KV doesn't require explicit cleanup
  }
}
