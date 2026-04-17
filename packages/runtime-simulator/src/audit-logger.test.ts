import { describe, expect, it } from 'vitest'
import { SimulatorAuditLogger } from './audit-logger.js'

describe('SimulatorAuditLogger', () => {
  it('uses Zebric runtime audit event names and action labels', () => {
    const auditLogger = new SimulatorAuditLogger()

    auditLogger.logDataAccess('create', 'Task', 'task-1', 'user', true)
    auditLogger.logAccessDenied('/tasks/new', 'create', 'Task', { session: { user: { id: 'user' } } })

    const [denied, created] = auditLogger.getEntries()

    expect(created?.metadata?.eventType).toBe('data.create')
    expect(created?.action).toBe('Data create')
    expect(created?.entity).toBe('Task')
    expect(created?.entityId).toBe('task-1')
    expect(created?.metadata?.entityType).toBe('Task')
    expect(created?.metadata?.entityId).toBe('task-1')

    expect(denied?.metadata?.eventType).toBe('access.denied')
    expect(denied?.action).toBe('Access denied: create')
    expect(denied?.entity).toBe('Task')
    expect(denied?.metadata?.entityType).toBe('Task')
    expect(denied?.metadata?.success).toBe(false)
  })
})
