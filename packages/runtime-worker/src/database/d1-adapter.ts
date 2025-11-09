/**
 * D1 Database Adapter
 *
 * Implements the StoragePort interface for CloudFlare D1 (SQLite).
 */

import type { StoragePort } from '@zebric/runtime-core'

export class D1Adapter implements StoragePort {
  constructor(private db: D1Database) {}

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    try {
      const stmt = params ? this.db.prepare(sql).bind(...params) : this.db.prepare(sql)
      const result = await stmt.all<T>()

      if (!result.success) {
        throw new Error(`D1 query failed: ${result.error || 'Unknown error'}`)
      }

      return { rows: result.results || [] }
    } catch (error) {
      throw new Error(`D1 query error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async transaction<T>(fn: (tx: StoragePort) => Promise<T>): Promise<T> {
    // D1 doesn't support explicit transactions via Workers API yet
    // We execute the function with the current adapter
    // In the future, this could use D1 batch operations
    return fn(this)
  }

  async migrate(statements: string[]): Promise<void> {
    // Execute migrations sequentially
    for (const statement of statements) {
      const result = await this.db.prepare(statement).run()
      if (!result.success) {
        throw new Error(`Migration failed: ${result.error || 'Unknown error'}`)
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.db.prepare('SELECT 1').first()
      return result !== null
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    // D1 doesn't require explicit cleanup
  }
}
