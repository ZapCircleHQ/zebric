/**
 * D1 Database Adapter
 *
 * Implements the SqlStoragePort interface for Cloudflare D1 (SQLite).
 */

import type { SqlStoragePort } from '@zebric/runtime-core'

export class D1Adapter implements SqlStoragePort {
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

  /** Execute a fixed set of statements as one atomic D1 batch. */
  async batch<T = unknown>(queries: Array<{ sql: string; params?: unknown[] }>): Promise<Array<{ rows: T[] }>> {
    const statements = queries.map(({ sql, params }) => {
      const statement = this.db.prepare(sql)
      return params ? statement.bind(...params) : statement
    })
    const results = await this.db.batch<T>(statements)
    return results.map((result) => {
      if (!result.success) {
        throw new Error(`D1 batch failed: ${result.error || 'Unknown error'}`)
      }
      return { rows: result.results || [] }
    })
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
