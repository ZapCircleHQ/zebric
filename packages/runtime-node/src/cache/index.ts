/**
 * Cache Module
 *
 * Provides caching abstractions with multiple backends.
 */

export { CacheInterface } from '@zebric/runtime-core'
export { MemoryCache } from './memory-cache.js'
export { RedisCache, type RedisCacheConfig } from './redis-cache.js'
