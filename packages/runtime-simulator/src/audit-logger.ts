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

  logAccessDenied(resource: string, action: string, entity?: string, context?: any): void {
    this.log({
      eventType: 'access.denied',
      severity: 'WARNING',
      action: `Access denied: ${action}`,
      resource,
      success: false,
      userId: context?.session?.user?.id,
      metadata: { entityType: entity },
    })
  }

  logDataAccess(
    action: string,
    entity: string,
    recordId?: string,
    userId?: string,
    success = true,
    context?: any
  ): void {
    this.log({
      eventType: `data.${action}`,
      severity: success ? 'INFO' : 'WARNING',
      action: `Data ${action}`,
      resource: entity,
      success,
      userId: userId ?? context?.session?.user?.id,
      metadata: { entityType: entity, entityId: recordId },
    })
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
      entity: event.metadata?.entityType ?? event.metadata?.entity ?? event.resource,
      entityId: event.metadata?.entityId ?? event.metadata?.recordId,
      metadata: {
        ...event.metadata,
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
