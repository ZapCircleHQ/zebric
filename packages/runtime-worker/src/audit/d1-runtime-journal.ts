import type { Actor, DomainCommandEvent, LogEvent } from '@zebric/runtime-core'
import { D1Adapter } from '../database/d1-adapter.js'

type Statement = { sql: string; params: unknown[] }
export interface StoredAuditEntry extends LogEvent {
  auditId: string
  timestamp: string
}
export interface StoredDomainEvent {
  id: string
  type: string
  occurredAt: string
  subject: string
  data: Record<string, unknown>
}

/** Append-only application history and a durable, ordered stream of command events. */
export class D1RuntimeJournal {
  private ready?: Promise<void>
  constructor(private readonly db: D1Adapter) {}

  private async initialize(): Promise<void> {
    this.ready ??= this.db
      .batch([
        {
          sql: `CREATE TABLE IF NOT EXISTS _zebric_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        entity TEXT, record_id TEXT, command TEXT, workflow TEXT, actor_id TEXT,
        entry_json TEXT NOT NULL
      )`
        },
        { sql: 'CREATE INDEX IF NOT EXISTS _zebric_audit_record ON _zebric_audit (entity, record_id, sequence)' },
        {
          sql: `CREATE TABLE IF NOT EXISTS _zebric_domain_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, audience TEXT NOT NULL,
        entity TEXT NOT NULL, record_id TEXT NOT NULL, event_json TEXT NOT NULL
      )`
        },
        {
          sql: 'CREATE INDEX IF NOT EXISTS _zebric_domain_events_audience ON _zebric_domain_events (audience, sequence)'
        }
      ])
      .then(() => undefined)
      .catch((error) => {
        this.ready = undefined
        throw error
      })
    await this.ready
  }

  async prepare(effects: { audit: LogEvent[]; events: DomainCommandEvent[] }): Promise<Statement[]> {
    await this.initialize()
    const statements: Statement[] = []
    for (const entry of effects.audit) {
      const stored = redact({
        ...entry,
        auditId: entry.auditId ?? crypto.randomUUID(),
        timestamp: new Date().toISOString()
      }) as StoredAuditEntry
      statements.push({
        sql: `INSERT INTO _zebric_audit (id, entity, record_id, command, workflow, actor_id, entry_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
        params: [
          stored.auditId,
          stored.entityType ?? null,
          stored.entityId ?? null,
          stored.actionName ?? stored.action,
          stored.workflowName ?? null,
          stored.actorId ?? null,
          JSON.stringify(stored)
        ]
      })
    }
    for (const event of effects.events) {
      // Event streams contain routing/identity metadata, never raw record values.
      const stored = {
        type: `domain.${event.name}`,
        occurredAt: event.occurredAt,
        subject: `${event.entity}:${event.recordId}`,
        data: {
          command: event.command,
          entity: event.entity,
          recordId: event.recordId,
          actor: { id: event.actor.id, type: event.actor.type },
          delegatedBy: event.actor.delegatedBy,
          correlationId: event.correlationId
        }
      }
      statements.push({
        sql: 'INSERT INTO _zebric_domain_events (audience, entity, record_id, event_json) VALUES (?, ?, ?, ?)',
        params: [eventAudience(event.actor), event.entity, event.recordId, JSON.stringify(stored)]
      })
    }
    return statements
  }

  async queryAudit(filters: {
    entity: string
    recordId: string
    command?: string
    workflow?: string
    actorId?: string
    limit?: number
  }): Promise<StoredAuditEntry[]> {
    await this.initialize()
    const clauses = ['entity = ?', 'record_id = ?']
    const params: unknown[] = [filters.entity, filters.recordId]
    for (const [column, value] of [
      ['command', filters.command],
      ['workflow', filters.workflow],
      ['actor_id', filters.actorId]
    ]) {
      if (value) {
        clauses.push(`${column} = ?`)
        params.push(value)
      }
    }
    params.push(Math.min(Math.max(filters.limit ?? 50, 1), 200))
    const { rows } = await this.db.query<{ entry_json: string }>(
      `SELECT entry_json FROM _zebric_audit WHERE ${clauses.join(' AND ')} ORDER BY sequence DESC LIMIT ?`,
      params
    )
    return rows.map((row) => JSON.parse(row.entry_json) as StoredAuditEntry)
  }

  async latestSequence(): Promise<number> {
    await this.initialize()
    const { rows } = await this.db.query<{ sequence: number }>(
      'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM _zebric_domain_events'
    )
    return rows[0]!.sequence
  }

  async queryEvents(audience: string, after: number, limit = 100): Promise<StoredDomainEvent[]> {
    await this.initialize()
    const { rows } = await this.db.query<{ sequence: number; event_json: string }>(
      'SELECT sequence, event_json FROM _zebric_domain_events WHERE audience = ? AND sequence > ? ORDER BY sequence LIMIT ?',
      [audience, after, Math.min(Math.max(limit, 1), 100)]
    )
    return rows.map((row) => ({ ...JSON.parse(row.event_json), id: String(row.sequence) }))
  }
}

export function eventAudience(actor: Actor): string {
  return actor.credentialId !== undefined ? `credential:${actor.credentialId}` : `actor:${actor.type}:${actor.id}`
}

function redact(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/password|secret|token|authorization|cookie|api.?key/i.test(key))
      .map(([key, item]) => [key, redact(item)])
  )
}
