/**
 * Cache Interface
 *
 * Defines the contract for cache implementations (in-memory, Redis, etc.)
 */

export interface CacheInterface {
  /**
   * Get a value from the cache
   */
  get<T>(key: string): Promise<T | null>

  /**
   * Set a value in the cache with optional TTL (in seconds)
   */
  set(key: string, value: any, ttl?: number): Promise<void>

  /**
   * Delete a value from the cache
   */
  delete(key: string): Promise<void>

  /**
   * Increment a numeric value
   */
  incr(key: string): Promise<number>

  /**
   * Check if a key exists
   */
  exists(key: string): Promise<boolean>

  /**
   * Clear all cache entries (use with caution)
   */
  clear(): Promise<void>

  /**
   * Close/cleanup the cache connection
   */
  close(): Promise<void>
}
