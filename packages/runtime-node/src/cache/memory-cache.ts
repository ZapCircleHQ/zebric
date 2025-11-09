/**
 * In-Memory Cache
 *
 * Simple in-memory cache implementation for development.
 * Not suitable for production with multiple instances.
 */

import type { CacheInterface } from '@zebric/runtime-core'

interface CacheEntry {
  value: any
  expiresAt?: number
}

export class MemoryCache implements CacheInterface {
  private store = new Map<string, CacheEntry>()

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) {
      return null
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return null
    }

    return entry.value as T
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const expiresAt = ttl && ttl > 0 ? Date.now() + ttl * 1000 : undefined
    this.store.set(key, { value, expiresAt })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async incr(key: string): Promise<number> {
    const now = Date.now()
    const entry = this.store.get(key)

    if (!entry || (entry.expiresAt && entry.expiresAt < now)) {
      this.store.set(key, { value: 1 })
      return 1
    }

    const next = Number(entry.value ?? 0) + 1
    this.store.set(key, {
      value: next,
      expiresAt: entry.expiresAt,
    })
    return next
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key)
    if (!entry) {
      return false
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return false
    }

    return true
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async close(): Promise<void> {
    // No-op for in-memory cache
    this.store.clear()
  }
}
