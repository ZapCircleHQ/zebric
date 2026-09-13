import { describe, expect, it, vi } from 'vitest'
import { createAuditLoggerPort, createQueryExecutorPort } from './engine-port-factory.js'

describe('engine port adapters', () => {
  it('preserves the caller context for findById', async () => {
    const findById = vi.fn().mockResolvedValue({ id: 'task-1' })
    const port = createQueryExecutorPort({ findById } as any)
    const context = { session: { user: { id: 'user-1' } } } as any

    await port.findById('Task', 'task-1', context)

    expect(findById).toHaveBeenCalledWith('Task', 'task-1', context)
  })

  it('maps the single audit event contract to the Node audit logger', () => {
    const log = vi.fn()
    const port = createAuditLoggerPort({ log } as any)
    const event = {
      eventType: 'access.denied',
      severity: 'WARNING',
      action: 'Access denied: update',
      resource: 'Task',
      success: false,
      userId: 'user-1',
      entityType: 'Task',
    }

    port.log(event)

    expect(log).toHaveBeenCalledWith(expect.objectContaining(event))
  })
})
