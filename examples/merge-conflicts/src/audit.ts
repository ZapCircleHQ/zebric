import type { AuditEvent, AuditSink } from './types.js'

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = []
  async append(event: AuditEvent): Promise<void> { this.events.push(structuredClone(event)) }
}
