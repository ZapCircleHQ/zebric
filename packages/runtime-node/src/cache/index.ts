/**
 * Cache Module
 *
 * Provides caching abstractions with multiple backends.
 */

export type { CachePort } from '@zebric/runtime-core'
export { MemoryCache } from './memory-cache.js'
export { RedisCache, type RedisCacheConfig } from './redis-cache.js'
