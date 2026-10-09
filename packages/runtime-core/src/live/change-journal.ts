import type { SqlStoragePort } from '../ports.js'
import type { LiveChangeSource, LiveDependency, ZebricChangeEvent } from './live.js'
import { validLiveCursor, DEFAULT_CHANGE_RETENTION_MS } from './live.js'

export const CHANGE_TABLE = '_zebric_changes'
const PRUNE_INTERVAL_MS = 10 * 60 * 1000
export function changeJournalSchema(postgres = false): string {
  return `CREATE TABLE IF NOT EXISTS ${CHANGE_TABLE} (
    sequence ${postgres ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
    id TEXT NOT NULL UNIQUE, entity TEXT NOT NULL, record_id TEXT,
    operation TEXT NOT NULL, timestamp TEXT NOT NULL)`
}

/** Minimal durable mutation metadata in runtime storage; never contains record values. */
export class SqlChangeJournal implements LiveChangeSource {
  private lastPrune = 0

  /** `retentionMs` of 0 or Infinity keeps the journal forever. */
  constructor(
    private readonly storage: SqlStoragePort,
    private readonly retentionMs = DEFAULT_CHANGE_RETENTION_MS,
  ) {}

  /** Delete rows past the retention window, always keeping the newest so the cursor never moves backwards. */
  async prune(now = Date.now()): Promise<void> {
    if (!(this.retentionMs > 0) || !Number.isFinite(this.retentionMs)) return
    await this.storage.query(
      `DELETE FROM ${CHANGE_TABLE} WHERE timestamp < ? AND sequence < (SELECT MAX(sequence) FROM ${CHANGE_TABLE})`,
      [new Date(now - this.retentionMs).toISOString()],
    )
  }

  /** Throttled, best-effort pruning piggybacked on reconcile; never blocks or fails a caller. */
  private maybePrune(): void {
    const now = Date.now()
    if (now - this.lastPrune < PRUNE_INTERVAL_MS) return
    this.lastPrune = now
    this.prune(now).catch(() => { this.lastPrune = 0 })
  }

  prepare(entity: string, operation: ZebricChangeEvent['operation'], recordId?: string): { sql: string; params: unknown[] } {
    return {
      sql: `INSERT INTO ${CHANGE_TABLE} (id, entity, record_id, operation, timestamp) VALUES (?, ?, ?, ?, ?)`,
      params: [crypto.randomUUID(), entity, recordId ?? null, operation, new Date().toISOString()],
    }
  }

  async currentCursor(): Promise<string> {
    const { rows } = await this.storage.query<{ cursor: number | string }>(
      `SELECT COALESCE(MAX(sequence), 0) AS cursor FROM ${CHANGE_TABLE}`,
    )
    return String(rows[0]?.cursor ?? 0)
  }

  async changesAfter(cursor: string, limit = 100): Promise<ZebricChangeEvent[]> {
    if (!validLiveCursor(cursor)) throw new Error('Invalid change cursor')
    const { rows } = await this.storage.query<{
      sequence: number | string; id: string; entity: string; record_id: string | null
      operation: ZebricChangeEvent['operation']; timestamp: string
    }>(
      `SELECT sequence, id, entity, record_id, operation, timestamp FROM ${CHANGE_TABLE} WHERE sequence > ? ORDER BY sequence LIMIT ?`,
      [Number(cursor), Math.min(Math.max(Math.floor(limit) || 100, 1), 1000)],
    )
    return rows.map(row => ({
      id: row.id, entity: row.entity, recordId: row.record_id ?? undefined,
      operation: row.operation, timestamp: row.timestamp, cursor: String(row.sequence),
    }))
  }

  async reconcile(dependencies: LiveDependency[], cursor: string): Promise<{ cursor: string; changed: boolean }> {
    this.maybePrune()
    const current = await this.currentCursor()
    // Database restore/reset must invalidate even if its cursor moved backwards.
    if (Number(cursor) > Number(current)) return { cursor: current, changed: true }
    if (!dependencies.length || cursor === current) return { cursor: current, changed: false }
    // Pruned history: a cursor behind the oldest retained row may have missed changes.
    const { rows: oldest } = await this.storage.query<{ oldest: number | string | null }>(
      `SELECT MIN(sequence) AS oldest FROM ${CHANGE_TABLE}`,
    )
    const first = oldest[0]?.oldest
    if (first != null && Number(cursor) < Number(first) - 1) return { cursor: current, changed: true }
    const { rows } = await this.storage.query(
      `SELECT sequence FROM ${CHANGE_TABLE} WHERE sequence > ? AND sequence <= ? AND entity IN (${dependencies.map(() => '?').join(', ')}) LIMIT 1`,
      [Number(cursor), Number(current), ...dependencies.map(dependency => dependency.entity)],
    )
    return { cursor: current, changed: rows.length > 0 }
  }
}
