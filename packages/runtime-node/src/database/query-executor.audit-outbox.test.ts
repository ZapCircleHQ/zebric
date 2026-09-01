import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Blueprint } from '@zebric/runtime-core'
import { DatabaseConnection } from './connection.js'
import { QueryExecutor } from './query-executor.js'

describe('QueryExecutor audit outbox', () => {
  let root: string | undefined
  let connection: DatabaseConnection | undefined

  afterEach(async () => {
    await connection?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })

  async function setup() {
    root = await mkdtemp(join(tmpdir(), 'zebric-audit-outbox-'))
    connection = new DatabaseConnection({ type: 'sqlite', filename: join(root, 'app.db') }, blueprint)
    await connection.connect()
    return new QueryExecutor(connection)
  }

  it('rejects audit intents created outside a transaction', async () => {
    const executor = await setup()
    await expect(executor.enqueueAuditOutbox({
      id: 'outside', topic: 'workflow.completed', payload: '{}', createdAt: 1,
    })).rejects.toThrow('inside a database transaction')
    expect(await executor.listPendingAuditOutbox()).toEqual([])
  })

  it('rolls back a success audit intent when the workflow transaction fails', async () => {
    const executor = await setup()
    await expect(executor.transaction(async () => {
      await executor.enqueueAuditOutbox({
        id: 'rolled-back', topic: 'workflow.completed', payload: '{"success":true}', createdAt: 1,
      })
      throw new Error('workflow failed')
    })).rejects.toThrow('workflow failed')
    expect(await executor.listPendingAuditOutbox()).toEqual([])
  })

  it('keeps a committed intent pending until delivery is acknowledged', async () => {
    const executor = await setup()
    await executor.transaction(() => executor.enqueueAuditOutbox({
      id: 'committed', topic: 'workflow.completed', payload: '{"success":true}', createdAt: 1,
    }))
    expect(await executor.listPendingAuditOutbox()).toEqual([{
      id: 'committed', topic: 'workflow.completed', payload: '{"success":true}', createdAt: 1,
    }])
    await executor.markAuditOutboxDelivered('committed')
    expect(await executor.listPendingAuditOutbox()).toEqual([])
  })
})

const blueprint: Blueprint = {
  version: '1.0.0',
  project: { name: 'Audit Outbox Test', version: '1.0.0', runtime: { min_version: '0.3.0' } },
  entities: [],
  pages: [],
}
