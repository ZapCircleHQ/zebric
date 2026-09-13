import type { AuditEvent, AuditLoggerPort, LogEvent } from '@zebric/runtime-core'
import { createSimulatorId } from './id.js'

export class SimulatorAuditLogger implements AuditLoggerPort {
  private entries: AuditEvent[] = []

  log(event: LogEvent): void {
    this.entries = [
      this.fromLogEvent(event),
      ...this.entries,
    ].slice(0, 500)
  }

  getEntries(): AuditEvent[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  private fromLogEvent(event: LogEvent): AuditEvent {
    return {
      id: createSimulatorId('audit'),
      timestamp: Date.now(),
      userId: event.userId,
      action: event.action,
      entity: event.entityType ?? event.metadata?.entityType ?? event.metadata?.entity ?? event.resource,
      entityId: event.entityId ?? event.metadata?.entityId ?? event.metadata?.recordId,
      metadata: {
        ...event.metadata,
        entityType: event.entityType ?? event.metadata?.entityType,
        entityId: event.entityId ?? event.metadata?.entityId,
        eventType: event.eventType,
        severity: event.severity,
        resource: event.resource,
        success: event.success,
      },
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    }
  }
}
