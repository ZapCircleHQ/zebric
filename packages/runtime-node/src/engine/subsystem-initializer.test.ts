import { describe, expect, it, vi } from 'vitest'
import { drainAuditOutbox } from './subsystem-initializer.js'

describe('drainAuditOutbox', () => {
  it('drains every batch instead of stopping after the first 100 records', async () => {
    const pending = Array.from({ length: 205 }, (_, index) => ({
      id: `event-${index}`,
      topic: 'workflow.completed',
      payload: JSON.stringify({ eventType: 'workflow.completed', action: `event-${index}` }),
      createdAt: index,
    }))
    const queryExecutor = {
      listPendingAuditOutbox: vi.fn(async (limit: number) => pending.slice(0, limit)),
      markAuditOutboxDelivered: vi.fn(async (id: string) => {
        const index = pending.findIndex(record => record.id === id)
        if (index >= 0) pending.splice(index, 1)
      }),
    }
    const auditLogger = { log: vi.fn(() => true) }

    await drainAuditOutbox(queryExecutor, auditLogger)

    expect(pending).toHaveLength(0)
    expect(auditLogger.log).toHaveBeenCalledTimes(205)
    expect(queryExecutor.listPendingAuditOutbox).toHaveBeenCalledTimes(4)
  })

  it('does not acknowledge a record when durable append fails', async () => {
    const queryExecutor = {
      listPendingAuditOutbox: vi.fn(async () => [{
        id: 'event-1', topic: 'workflow.completed', payload: '{}', createdAt: 1,
      }]),
      markAuditOutboxDelivered: vi.fn(),
    }
    await expect(drainAuditOutbox(queryExecutor, { log: () => false }))
      .rejects.toThrow('delivery failed')
    expect(queryExecutor.markAuditOutboxDelivered).not.toHaveBeenCalled()
  })
})
