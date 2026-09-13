/** A recorded runtime audit entry. */
export interface AuditEvent {
  id: string
  timestamp: number
  userId?: string
  sessionId?: string
  action: string
  entity?: string
  entityId?: string
  changes?: Record<string, unknown>
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}
