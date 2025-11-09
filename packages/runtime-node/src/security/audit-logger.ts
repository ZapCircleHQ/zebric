/**
 * Security Audit Logger
 *
 * Write-once, read-many audit trail for security events.
 * Separate from application logging, immutable once written.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { UserSession } from '@zebric/runtime-core'

export enum AuditEventType {
  // Authentication Events
  AUTH_LOGIN_SUCCESS = 'auth.login.success',
  AUTH_LOGIN_FAILURE = 'auth.login.failure',
  AUTH_LOGOUT = 'auth.logout',
  AUTH_REGISTER = 'auth.register',
  AUTH_PASSWORD_RESET = 'auth.password_reset',
  AUTH_SESSION_EXPIRED = 'auth.session_expired',

  // Authorization Events
  ACCESS_GRANTED = 'access.granted',
  ACCESS_DENIED = 'access.denied',
  PERMISSION_VIOLATION = 'permission.violation',

  // Data Access Events
  DATA_READ = 'data.read',
  DATA_CREATE = 'data.create',
  DATA_UPDATE = 'data.update',
  DATA_DELETE = 'data.delete',

  // Security Events
  SUSPICIOUS_ACTIVITY = 'security.suspicious',
  RATE_LIMIT_EXCEEDED = 'security.rate_limit',
  INVALID_INPUT = 'security.invalid_input',
  CSRF_VIOLATION = 'security.csrf',
  XSS_ATTEMPT = 'security.xss_attempt',
  SQL_INJECTION_ATTEMPT = 'security.sql_injection',

  // System Events
  CONFIG_CHANGE = 'system.config_change',
  BLUEPRINT_RELOAD = 'system.blueprint_reload',
}

export enum AuditSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

export interface AuditLogEntry {
  // Core fields
  timestamp: string // ISO 8601
  eventType: AuditEventType
  severity: AuditSeverity

  // User context
  userId?: string
  userEmail?: string
  sessionId?: string
  ipAddress?: string
  userAgent?: string

  // Action details
  action: string
  resource?: string
  entityType?: string
  entityId?: string

  // Result
  success: boolean
  errorMessage?: string

  // Additional context
  metadata?: Record<string, any>

  // Security
  requestId?: string
  signature?: string // For tamper detection (future)
}

export interface AuditLoggerConfig {
  logPath?: string // Path to audit log file
  enabled?: boolean
  splitLogs?: boolean // If true, separate audit from app logs
  includeMetadata?: boolean
  maxEntrySize?: number // Max size of metadata field
}

export class AuditLogger {
  private config: Required<AuditLoggerConfig>
  private logPath: string

  constructor(config: AuditLoggerConfig = {}) {
    this.config = {
      logPath: config.logPath || './data/audit.log',
      enabled: config.enabled !== false, // Default to true
      splitLogs: config.splitLogs !== false, // Default to true (separate)
      includeMetadata: config.includeMetadata !== false,
      maxEntrySize: config.maxEntrySize || 10000, // 10KB per entry
    }

    this.logPath = this.config.logPath

    // Ensure directory exists
    this.ensureLogDirectory()
  }

  /**
   * Log an audit event (write-once)
   */
  log(event: Partial<AuditLogEntry> & { eventType: AuditEventType; action: string }): void {
    if (!this.config.enabled) {
      return
    }

    try {
      const fullEvent = this.buildEvent(event)
      const logEntry = this.formatLogEntry(fullEvent)

      // Write-once: append to file (immutable)
      appendFileSync(this.logPath, logEntry + '\n', { encoding: 'utf8', mode: 0o644 })

      // Also log to console if not split (for dev visibility)
      if (!this.config.splitLogs) {
        console.log(`[AUDIT] ${event.eventType}: ${event.action}`)
      }
    } catch (error) {
      // NEVER throw from audit logger - log to stderr instead
      console.error('[AUDIT ERROR] Failed to write audit log:', error)
    }
  }

  /**
   * Log authentication success
   */
  logAuthSuccess(userId: string, email?: string, context?: Partial<AuditLogEntry>): void {
    this.log({
      eventType: AuditEventType.AUTH_LOGIN_SUCCESS,
      severity: AuditSeverity.INFO,
      action: 'User logged in',
      userId,
      userEmail: email,
      success: true,
      ...context,
    })
  }

  /**
   * Log authentication failure
   */
  logAuthFailure(email: string, reason: string, context?: Partial<AuditLogEntry>): void {
    this.log({
      eventType: AuditEventType.AUTH_LOGIN_FAILURE,
      severity: AuditSeverity.WARNING,
      action: 'Login attempt failed',
      userEmail: email,
      success: false,
      errorMessage: reason,
      ...context,
    })
  }

  /**
   * Log access denied
   */
  logAccessDenied(
    resource: string,
    action: string,
    userId?: string,
    context?: Partial<AuditLogEntry>
  ): void {
    this.log({
      eventType: AuditEventType.ACCESS_DENIED,
      severity: AuditSeverity.WARNING,
      action: `Access denied: ${action}`,
      resource,
      userId,
      success: false,
      ...context,
    })
  }

  /**
   * Log data access
   */
  logDataAccess(
    operation: 'read' | 'create' | 'update' | 'delete',
    entityType: string,
    entityId: string | undefined,
    userId: string | undefined,
    success: boolean,
    context?: Partial<AuditLogEntry>
  ): void {
    const eventTypeMap = {
      read: AuditEventType.DATA_READ,
      create: AuditEventType.DATA_CREATE,
      update: AuditEventType.DATA_UPDATE,
      delete: AuditEventType.DATA_DELETE,
    }

    this.log({
      eventType: eventTypeMap[operation],
      severity: success ? AuditSeverity.INFO : AuditSeverity.WARNING,
      action: `Data ${operation}`,
      entityType,
      entityId,
      userId,
      success,
      ...context,
    })
  }

  /**
   * Log suspicious activity
   */
  logSuspiciousActivity(
    description: string,
    severity: AuditSeverity,
    context?: Partial<AuditLogEntry>
  ): void {
    this.log({
      eventType: AuditEventType.SUSPICIOUS_ACTIVITY,
      severity,
      action: description,
      success: false,
      ...context,
    })
  }

  /**
   * Build complete audit event
   */
  private buildEvent(partial: Partial<AuditLogEntry> & { eventType: AuditEventType; action: string }): AuditLogEntry {
    return {
      timestamp: new Date().toISOString(),
      severity: partial.severity || AuditSeverity.INFO,
      success: partial.success !== false,
      eventType: partial.eventType,
      action: partial.action,
      userId: partial.userId,
      userEmail: partial.userEmail,
      sessionId: partial.sessionId,
      ipAddress: partial.ipAddress,
      userAgent: partial.userAgent,
      resource: partial.resource,
      entityType: partial.entityType,
      entityId: partial.entityId,
      errorMessage: partial.errorMessage,
      metadata: this.sanitizeMetadata(partial.metadata),
      requestId: partial.requestId,
    }
  }

  /**
   * Format audit event as JSON log entry
   */
  private formatLogEntry(event: AuditLogEntry): string {
    // JSON format for structured logging and easy parsing
    return JSON.stringify(event)
  }

  /**
   * Sanitize metadata to prevent excessive log size
   */
  private sanitizeMetadata(metadata?: Record<string, any>): Record<string, any> | undefined {
    if (!metadata || !this.config.includeMetadata) {
      return undefined
    }

    const sanitized: Record<string, any> = {}
    let totalSize = 0

    for (const [key, value] of Object.entries(metadata)) {
      // Skip sensitive fields
      if (this.isSensitiveField(key)) {
        sanitized[key] = '[REDACTED]'
        continue
      }

      const serialized = JSON.stringify(value)
      const size = serialized.length

      // Check size limit
      if (totalSize + size > this.config.maxEntrySize) {
        sanitized[key] = '[TRUNCATED]'
        break
      }

      sanitized[key] = value
      totalSize += size
    }

    return sanitized
  }

  /**
   * Check if field name is sensitive
   */
  private isSensitiveField(fieldName: string): boolean {
    const sensitive = [
      'password',
      'secret',
      'token',
      'apikey',
      'api_key',
      'private_key',
      'privatekey',
      'ssn',
      'credit_card',
      'creditcard',
    ]

    const lower = fieldName.toLowerCase()
    return sensitive.some(s => lower.includes(s))
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectory(): void {
    const dir = dirname(this.logPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Helper to extract audit context from session and request
   */
  static extractContext(session?: UserSession | null, request?: any): Partial<AuditLogEntry> {
    return {
      userId: session?.user?.id,
      userEmail: session?.user?.email,
      sessionId: (session as any)?.sessionId || (session as any)?.id,
      ipAddress: request?.ip || request?.headers?.['x-forwarded-for'],
      userAgent: request?.headers?.['user-agent'],
    }
  }
}
