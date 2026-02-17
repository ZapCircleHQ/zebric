/**
 * Engine Port Factory
 *
 * Pure factory functions that create port adapters for the runtime-core layer.
 */

import type { QueryExecutorPort, SessionManagerPort, AuditLoggerPort } from '@zebric/runtime-core'
import type { QueryExecutor } from './database/index.js'
import type { SessionManager } from '@zebric/runtime-core'
import type { AuditLogger } from './security/index.js'

export function createQueryExecutorPort(queryExecutor: QueryExecutor): QueryExecutorPort {
  return {
    execute: (query, context) => queryExecutor.execute(query, context),
    create: (entity, data, context) => queryExecutor.create(entity, data, context),
    update: (entity, id, data, context) => queryExecutor.update(entity, id, data, context),
    delete: (entity, id, context) => queryExecutor.delete(entity, id, context),
    findById: (entity, id) => queryExecutor.findById(entity, id)
  }
}

export function createSessionManagerPort(sessionManager: SessionManager): SessionManagerPort {
  return {
    getSession: async (request) => {
      const headers = new Headers()
      Object.entries(request.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          headers.set(key, value)
        } else if (Array.isArray(value) && value.length > 0) {
          headers.set(key, value[0])
        }
      })

      const fetchRequest = new Request(request.url, {
        method: request.method,
        headers
      })

      return sessionManager.getSession(fetchRequest)
    }
  }
}

export function createAuditLoggerPort(auditLogger: AuditLogger): AuditLoggerPort {
  return {
    log: (event: any) => {
      auditLogger.log({
        eventType: event.eventType as any,
        action: event.action,
        severity: (event.severity as any) || 'INFO',
        resource: event.resource,
        success: event.success !== false,
        userId: event.userId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: event.metadata
      })
    },
    logAccessDenied: (resource: string, action: string, entity?: string, context?: any) => {
      auditLogger.logAccessDenied(resource, action, context?.userId, {
        entityType: entity,
        ...context
      })
    },
    logDataAccess: (action, entity, recordId, userId, success, context) => {
      auditLogger.logDataAccess(action as any, entity, recordId, userId, success ?? true, context)
    }
  }
}
