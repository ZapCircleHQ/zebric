import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ulid } from 'ulid'
import type { Blueprint } from '@zebric/runtime-core'
import { DatabaseConnection } from './connection.js'
import { QueryExecutor } from './query-executor.js'

const postgresUrl = process.env.ZEBRIC_TEST_POSTGRES_URL
const describePostgres = postgresUrl ? describe : describe.skip

describePostgres('QueryExecutor PostgreSQL transactions', () => {
  let connection: DatabaseConnection
  let executor: QueryExecutor

  beforeAll(async () => {
    connection = new DatabaseConnection({ type: 'postgres', url: postgresUrl! }, blueprint)
    await connection.connect()
    executor = new QueryExecutor(connection)
  })

  afterAll(async () => {
    await connection?.close()
  })

  it('commits a multi-entity state transition and result together', async () => {
    const issueId = ulid()
    const resultId = ulid()
    await executor.create('TransactionIssue', { id: issueId, state: 'testing' })

    await executor.transaction(async () => {
      await executor.updateWhere('TransactionIssue', issueId, { state: 'testing' }, { state: 'completed' })
      await executor.create('TransactionResult', { id: resultId, issueId, outcome: 'passed' })
    })

    expect(await executor.findById('TransactionIssue', issueId)).toMatchObject({ state: 'completed' })
    expect(await executor.findById('TransactionResult', resultId)).toMatchObject({ issueId, outcome: 'passed' })
  })

  it('rolls back the state transition when result creation fails', async () => {
    const issueId = ulid()
    const duplicateResultId = ulid()
    await executor.create('TransactionIssue', { id: issueId, state: 'testing' })
    await executor.create('TransactionResult', {
      id: duplicateResultId,
      issueId,
      outcome: 'existing',
    })

    await expect(executor.transaction(async () => {
      await executor.updateWhere('TransactionIssue', issueId, { state: 'testing' }, { state: 'completed' })
      await executor.create('TransactionResult', {
        id: duplicateResultId,
        issueId,
        outcome: 'passed',
      })
    })).rejects.toThrow()

    expect(await executor.findById('TransactionIssue', issueId)).toMatchObject({ state: 'testing' })
  })

  it('commits and rolls back audit outbox intents with their transaction', async () => {
    const committedId = `postgres-committed-${ulid()}`
    const rolledBackId = `postgres-rolled-back-${ulid()}`

    await executor.transaction(() => executor.enqueueAuditOutbox({
      id: committedId,
      topic: 'workflow.completed',
      payload: '{"success":true}',
      createdAt: Date.now(),
    }))
    await expect(executor.transaction(async () => {
      await executor.enqueueAuditOutbox({
        id: rolledBackId,
        topic: 'workflow.completed',
        payload: '{"success":true}',
        createdAt: Date.now(),
      })
      throw new Error('rollback audit intent')
    })).rejects.toThrow('rollback audit intent')

    const pending = await executor.listPendingAuditOutbox(1_000)
    expect(pending.some(record => record.id === committedId)).toBe(true)
    expect(pending.some(record => record.id === rolledBackId)).toBe(false)
    await executor.markAuditOutboxDelivered(committedId)
  })
})

const blueprint: Blueprint = {
  version: '1.0.0',
  project: {
    name: 'Postgres Transaction Test',
    version: '1.0.0',
    runtime: { min_version: '0.3.0' },
  },
  entities: [
    {
      name: 'TransactionIssue',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true, required: true },
        { name: 'state', type: 'Text', required: true },
      ],
    },
    {
      name: 'TransactionResult',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true, required: true },
        { name: 'issueId', type: 'Text', required: true },
        { name: 'outcome', type: 'Text', required: true },
      ],
    },
  ],
  pages: [],
}
