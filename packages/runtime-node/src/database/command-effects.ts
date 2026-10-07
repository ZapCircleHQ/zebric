import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { CommandEffectsPort } from '@zebric/runtime-core'
import { AuditEventType, AuditSeverity, type AuditLogger } from '../security/audit-logger.js'
import type { AgentEventBus, AgentEventInput } from '../engine/agent-event-bus.js'
import type { QueryExecutor } from './query-executor.js'

/** Commit command audit/event intents with the command, then recover delivery. */
export class NodeCommandEffects implements CommandEffectsPort {
  private draining?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  constructor(
    private db: QueryExecutor,
    private bus: AgentEventBus,
    private audit?: AuditLogger,
    private onDeliveryError?: (error: unknown) => void
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.drain()
    }, 1000)
    this.timer.unref()
    void this.drain()
  }
  async stop(): Promise<void> {
    clearInterval(this.timer)
    this.timer = undefined
    await this.draining
  }

  async enqueue(effects: Parameters<CommandEffectsPort['enqueue']>[0]): Promise<void> {
    if (!this.db.inTransaction) throw new Error('Command effects require a database transaction')
    if (this.audit && this.audit.isEnabled?.() !== false)
      for (const event of effects.audit) {
        const id = randomUUID()
        await this.db.enqueueAuditOutbox({
          id,
          topic: AuditEventType.DOMAIN_COMMAND,
          createdAt: Date.now(),
          payload: JSON.stringify({
            ...event,
            auditId: id,
            eventType: AuditEventType.DOMAIN_COMMAND,
            severity: AuditSeverity.INFO
          })
        })
      }
    for (const event of effects.events) {
      const id = randomUUID()
      const value: AgentEventInput = {
        id,
        occurredAt: event.occurredAt,
        type: `domain.${event.name}`,
        subject: `${event.entity}:${event.recordId}`,
        audienceId: event.actor.credentialId ?? event.actor.id,
        data: {
          command: event.command,
          entity: event.entity,
          recordId: event.recordId,
          actor: { id: event.actor.id, type: event.actor.type },
          delegatedBy: event.actor.delegatedBy,
          correlationId: event.correlationId
        }
      }
      await this.db.queryRuntime(sql`INSERT INTO __zbl_command_events (id, value, created_at)
        VALUES (${id}, ${JSON.stringify(value)}, ${Date.now()})`)
    }
    await this.db.afterCommit(() => this.db.outsideTransaction(() => this.drain()))
  }

  async drain(): Promise<void> {
    if (this.draining) return this.draining
    // Delivery failures leave the committed intents pending and never fail a committed command.
    this.draining = this.deliver()
      .catch((error) => {
        this.onDeliveryError?.(error)
      })
      .finally(() => {
        this.draining = undefined
      })
    return this.draining
  }
  private async deliver(): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.lockRuntimeDelivery('command-effects')
      const audits = await this.db.listPendingAuditOutbox(100)
      for (const record of audits) {
        if (record.topic !== AuditEventType.DOMAIN_COMMAND || !this.audit || this.audit.isEnabled?.() === false) continue
        if (!this.audit.log(JSON.parse(record.payload))) throw new Error('Command audit delivery failed')
        await this.db.markAuditOutboxDelivered(record.id)
      }
      const events = await this.db.queryRuntime<{
        id: string
        value: string
      }>(sql`SELECT id, value FROM __zbl_command_events
        WHERE delivered_at IS NULL ORDER BY created_at, id LIMIT 100`)
      for (const event of events) {
        this.bus.publish(JSON.parse(event.value))
        await this.db.queryRuntime(
          sql`UPDATE __zbl_command_events SET delivered_at = ${Date.now()} WHERE id = ${event.id}`
        )
      }
    })
  }
}
