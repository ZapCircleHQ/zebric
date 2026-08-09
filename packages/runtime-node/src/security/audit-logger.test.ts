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
})
