import { WorkflowStore, WorkflowLeaseLostError } from '../workflows/workflow-store.js'
import type { Workflow, WorkflowJob } from '../workflows/types.js'
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
  it('serializes durable receipt replay across independent PostgreSQL connections', async () => {
    const other = new DatabaseConnection({ type: 'postgres', url: postgresUrl! }, blueprint)
    await other.connect()
    try {
      const independent = new QueryExecutor(other)
      const receipt = { key: `postgres-receipt-${ulid()}`, fingerprint: 'same' }
      const id = ulid()
      let calls = 0
      const operation = async (db: QueryExecutor) => {
        calls++
        await db.create('TransactionIssue', { id, state: 'completed' })
        return { id, at: new Date('2025-01-01'), typed: [true, 42, undefined] }
      }
      const [first, replay] = await Promise.all([
        executor.transaction(() => operation(executor), receipt),
        independent.transaction(() => operation(independent), receipt),
      ])
      expect(calls).toBe(1)
      expect(replay).toEqual(first)
      await expect(independent.transaction(() => operation(independent), { ...receipt, fingerprint: 'different' }))
        .rejects.toThrow('Idempotency')
    } finally { await other.close() }
  })

  it('fences a reclaimed workflow lease across PostgreSQL connections', async () => {
    const other = new DatabaseConnection({ type: 'postgres', url: postgresUrl! }, blueprint)
    await other.connect()
    let now = Date.now()
    const workflow: Workflow = { name: `postgres-workflow-${ulid()}`, trigger: { manual: true }, steps: [] }
    const job: WorkflowJob = { id: ulid(), workflowName: workflow.name, status: 'pending', createdAt: new Date(), attempts: 0,
      context: { trigger: { type: 'manual' }, variables: {} } }
    try {
      const first = new WorkflowStore(executor, 100, () => now)
      const second = new WorkflowStore(new QueryExecutor(other), 100, () => now)
      await first.create(job, workflow)
      const owned = (await first.claim([workflow.name]))!
      expect(await second.claim([workflow.name])).toBeUndefined()
      now += 101
      const reclaimed = (await second.claim([workflow.name]))!
      await expect(first.saveCheckpoint(owned.job, 'stale', true)).rejects.toBeInstanceOf(WorkflowLeaseLostError)
      await second.saveCheckpoint(reclaimed.job, 'typed', { date: new Date('2025-01-01'), values: [true, undefined] })
      expect((await second.checkpoint(reclaimed.job, 'typed')).value).toEqual({ date: new Date('2025-01-01'), values: [true, undefined] })
      expect(await first.finish(owned.job, 'completed')).toBe(false)
      expect(await second.finish(reclaimed.job, 'completed')).toBe(true)
    } finally { await other.close() }
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
