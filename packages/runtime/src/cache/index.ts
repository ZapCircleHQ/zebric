/**
 * Cache Module
 *
 * Provides caching abstractions with multiple backends.
 */

export { CacheInterface } from './cache-interface.js'
export { MemoryCache } from './memory-cache.js'
export { RedisCache, type RedisCacheConfig } from './redis-cache.js'
