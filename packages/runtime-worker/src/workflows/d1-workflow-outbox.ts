import type { UserSession } from '@zebric/runtime-core'
import { AsyncLocalStorage } from 'node:async_hooks'
import { D1Adapter } from '../database/d1-adapter.js'
import { sanitizedSession } from './durable-workflow.js'

export interface WorkflowEventIntent {
  entity: string
  event: 'create' | 'update' | 'delete'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  session?: UserSession | null
  workflowPath?: string[]
}

interface OutboxRow {
  id: string
  event_json: string
  attempts: number
}

const table = '_zebric_workflow_outbox'

/** Persistent delivery intents; claims and acknowledgements are fenced by lease tokens. */
export class D1WorkflowOutbox {
  private ready?: Promise<void>
  private readonly deliveryScope = new AsyncLocalStorage<boolean>()
  private readonly now: () => number
  private readonly leaseMs: number
  private readonly retryDelayMs: number

  constructor(
    private readonly db: D1Adapter,
    options: { now?: () => number; leaseMs?: number; retryDelayMs?: number } = {}
  ) {
    this.now = options.now ?? Date.now
    this.leaseMs = options.leaseMs ?? 5 * 60 * 1000
    this.retryDelayMs = options.retryDelayMs ?? 1000
  }

  private async initialize(): Promise<void> {
    this.ready ??= this.db
      .batch([
        {
          sql: `CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY, event_json TEXT NOT NULL, created_at INTEGER NOT NULL,
        available_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT, lease_expires_at INTEGER, delivered_at INTEGER, last_error TEXT
      )`
        },
        {
          sql: `CREATE INDEX IF NOT EXISTS _zebric_workflow_outbox_pending ON ${table} (delivered_at, available_at, lease_expires_at)`
        }
      ])
      .then(() => undefined)
      .catch((error) => {
        this.ready = undefined
        throw error
      })
    await this.ready
  }

  /** Prepare an insert for the caller's atomic mutation/receipt commit. */
  async prepare(
    intent: WorkflowEventIntent,
    id: string = crypto.randomUUID()
  ): Promise<{ sql: string; params: unknown[] }> {
    await this.initialize()
    const event = { ...intent, session: sanitizedSession(intent.session ?? undefined) }
    const now = this.now()
    return {
      sql: `INSERT INTO ${table} (id, event_json, created_at, available_at) VALUES (?, ?, ?, ?)`,
      params: [id, JSON.stringify(event), now, now]
    }
  }

  async drain(
    deliver: (intent: WorkflowEventIntent, id: string) => Promise<void>,
    limit = 25
  ): Promise<{ delivered: number; failed: number }> {
    // Inline children can commit more events while their parent is being
    // delivered. Let the outer drain pick them up rather than recursing.
    if (this.deliveryScope.getStore()) return { delivered: 0, failed: 0 }
    return this.deliveryScope.run(true, () => this.deliverBatch(deliver, limit))
  }

  private async deliverBatch(
    deliver: (intent: WorkflowEventIntent, id: string) => Promise<void>,
    limit: number
  ): Promise<{ delivered: number; failed: number }> {
    await this.initialize()
    const report = { delivered: 0, failed: 0 }
    for (let index = 0; index < limit; index++) {
      const token = crypto.randomUUID()
      const now = this.now()
      const { rows } = await this.db.query<OutboxRow>(
        `UPDATE ${table} SET lease_token = ?, lease_expires_at = ?, attempts = attempts + 1
        WHERE id = (SELECT id FROM ${table} WHERE delivered_at IS NULL AND available_at <= ?
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?) ORDER BY created_at, id LIMIT 1)
        RETURNING id, event_json, attempts`,
        [token, now + this.leaseMs, now, now]
      )
      const row = rows[0]
      if (!row) break
      // Long inline jobs renew their claim. A lost lease can still lead to a
      // redelivery; native Workflow instance IDs make submissions idempotent.
      let renewal: Promise<unknown> = Promise.resolve()
      const timer = setInterval(
        () => {
          renewal = renewal
            .then(() =>
              this.db.query(
                `UPDATE ${table} SET lease_expires_at = ? WHERE id = ? AND lease_token = ? AND delivered_at IS NULL`,
                [this.now() + this.leaseMs, row.id, token]
              )
            )
            .catch(() => undefined)
        },
        Math.max(100, Math.floor(this.leaseMs / 3))
      )
      try {
        const intent = JSON.parse(row.event_json) as WorkflowEventIntent
        if (intent.session) {
          intent.session.createdAt = new Date(intent.session.createdAt)
          intent.session.expiresAt = new Date(intent.session.expiresAt)
        }
        await deliver(intent, row.id)
        const acknowledged = await this.db.query(
          `UPDATE ${table} SET delivered_at = ?, lease_token = NULL, lease_expires_at = NULL, last_error = NULL
          WHERE id = ? AND lease_token = ? AND delivered_at IS NULL RETURNING id`,
          [this.now(), row.id, token]
        )
        report.delivered += acknowledged.rows.length
      } catch {
        await this.db.query(
          `UPDATE ${table} SET available_at = ?, lease_token = NULL, lease_expires_at = NULL, last_error = ?
          WHERE id = ? AND lease_token = ? AND delivered_at IS NULL`,
          [
            this.now() + Math.min(5 * 60 * 1000, this.retryDelayMs * 2 ** Math.min(row.attempts - 1, 20)),
            'Workflow trigger delivery failed',
            row.id,
            token
          ]
        )
        report.failed++
      } finally {
        clearInterval(timer)
        await renewal
      }
    }
    return report
  }
}
