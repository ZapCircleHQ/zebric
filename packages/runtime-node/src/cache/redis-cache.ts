/**
 * Redis Cache
 *
 * Redis-backed cache implementation for production.
 * Supports distributed caching across multiple instances.
 */

import Redis from 'ioredis'
import type { CacheInterface } from '@zebric/runtime-core'

export interface RedisCacheConfig {
  host?: string
  port?: number
  password?: string
  db?: number
  url?: string
  keyPrefix?: string
}

export class RedisCache implements CacheInterface {
  private client: Redis

  constructor(config: RedisCacheConfig = {}) {
    // If URL is provided, use it
    if (config.url) {
      this.client = new Redis(config.url, {
        keyPrefix: config.keyPrefix || 'zbl:',
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000)
          return delay
        },
      })
    } else {
      // Use individual config options
      this.client = new Redis({
        host: config.host || 'localhost',
        port: config.port || 6379,
        password: config.password,
        db: config.db || 0,
        keyPrefix: config.keyPrefix || 'zbl:',
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000)
          return delay
        },
      })
    }

    // Handle connection errors
    this.client.on('error', (err) => {
      console.error('Redis connection error:', err)
    })

    this.client.on('connect', () => {
      console.log('✅ Connected to Redis cache')
    })
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key)
    if (value === null) {
      return null
    }

    try {
      return JSON.parse(value) as T
    } catch {
      // If JSON parse fails, return raw value
      return value as T
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value)

    if (ttl && ttl > 0) {
      await this.client.setex(key, ttl, serialized)
    } else {
      await this.client.set(key, serialized)
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key)
  }

  async incr(key: string): Promise<number> {
    return await this.client.incr(key)
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key)
    return result === 1
  }

  async clear(): Promise<void> {
    // Only clear keys with our prefix to avoid affecting other applications
    const keys = await this.client.keys('*')
    if (keys.length > 0) {
      await this.client.del(...keys)
    }
  }

  async close(): Promise<void> {
    await this.client.quit()
  }

  /**
   * Get the underlying Redis client for advanced operations
   */
  getClient(): Redis {
    return this.client
  }
}
