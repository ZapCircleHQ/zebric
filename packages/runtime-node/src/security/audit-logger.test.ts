import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditEventType, AuditLogger } from './audit-logger.js'

describe('AuditLogger agent attribution', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('persists attribution while omitting undefined metadata and secret values', () => {
    root = mkdtempSync(join(tmpdir(), 'zebric-audit-'))
    const path = join(root, 'audit.log')
    const logger = new AuditLogger({ logPath: path })
    logger.log({
      eventType: AuditEventType.AGENT_ACTION,
      action: 'qa.complete',
      actorType: 'agent',
      actorId: 'qa-agent',
      credentialId: 'credential-1',
      runId: 'run-1',
      metadata: { workflow: undefined, apiKey: 'must-not-appear' },
    })

    const entry = JSON.parse(readFileSync(path, 'utf8'))
    expect(entry).toMatchObject({
      actorType: 'agent', actorId: 'qa-agent', credentialId: 'credential-1', runId: 'run-1',
      metadata: { apiKey: '[REDACTED]' },
    })
    expect(readFileSync(path, 'utf8')).not.toContain('must-not-appear')
  })

  it('reports a failed durable append so an outbox record is not acknowledged', () => {
    root = mkdtempSync(join(tmpdir(), 'zebric-audit-'))
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = new AuditLogger({ logPath: root })

    expect(logger.log({
      eventType: AuditEventType.WORKFLOW_COMPLETED,
      action: 'Workflow completed: Test',
    })).toBe(false)
    expect(stderr).toHaveBeenCalledWith(
      '[AUDIT ERROR] Failed to write audit log:',
      expect.anything()
    )
    stderr.mockRestore()
  })

  it('returns a bounded filtered application-facing history view', () => {
    root = mkdtempSync(join(tmpdir(), 'zebric-audit-'))
    const logger = new AuditLogger({ logPath: join(root, 'audit.log') })
    logger.log({
      eventType: AuditEventType.DOMAIN_COMMAND, action: 'ApproveRequest', actionName: 'ApproveRequest',
      entityType: 'Request', entityId: 'req-1', actorId: 'approver-1', success: true,
      metadata: { command: 'ApproveRequest', mutation: { status: 'approved' } },
    })
    logger.log({
      eventType: AuditEventType.DOMAIN_COMMAND, action: 'ApproveRequest', actionName: 'ApproveRequest',
      entityType: 'Request', entityId: 'req-2', actorId: 'approver-2', success: true,
    })
    expect(logger.query({ entityType: 'Request', entityId: 'req-1', command: 'ApproveRequest' }))
      .toEqual([expect.objectContaining({
        entityId: 'req-1', actorId: 'approver-1',
        metadata: expect.objectContaining({ mutation: { status: 'approved' } }),
      })])
  })
})
