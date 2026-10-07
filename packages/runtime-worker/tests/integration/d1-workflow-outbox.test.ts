import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Miniflare } from 'miniflare'
import { SYSTEM_SESSION } from '@zebric/runtime-core'
import { D1Adapter } from '../../src/database/d1-adapter.js'
import { WorkersQueryExecutor } from '../../src/query/workers-query-executor.js'
import { D1WorkflowExecutor } from '../../src/workflows/d1-workflow-executor.js'
import { D1WorkflowOutbox, type WorkflowEventIntent } from '../../src/workflows/d1-workflow-outbox.js'

const blueprint = {
  entities: [
    {
      name: 'Item',
      fields: [
        { name: 'id', type: 'Text', primary_key: true },
        { name: 'value', type: 'Text' }
      ]
    }
  ]
} as any
const intent: WorkflowEventIntent = {
  entity: 'Item',
  event: 'update',
  before: { id: 'item', value: 'old' },
  after: { id: 'item', value: 'new' },
  session: SYSTEM_SESSION
}
const context = { session: SYSTEM_SESSION }

function provider() {
  const instances = new Map<string, any>()
  return {
    instances,
    binding: {
      create: vi.fn(async ({ id, params }: any) => {
        if (instances.has(id)) throw new Error('exists')
        instances.set(id, params)
        return { id }
      }),
      get: vi.fn(async (id: string) => ({ status: async () => ({ status: instances.has(id) ? 'queued' : 'unknown' }) }))
    } as any
  }
}

describe('D1 workflow delivery outbox', () => {
  let mf: Miniflare
  let db: D1Adapter
  let queries: WorkersQueryExecutor
  let outbox: D1WorkflowOutbox
  let now: number
  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-04-28',
      d1Databases: { DB: 'workflow-outbox' }
    })
    db = new D1Adapter(await mf.getD1Database('DB'))
    await db.query('CREATE TABLE Item (id TEXT PRIMARY KEY, value TEXT)')
    await new D1WorkflowOutbox(db).drain(async () => {})
    queries = new WorkersQueryExecutor(db, blueprint)
  })
  beforeEach(async () => {
    now = Date.now() + 1000
    outbox = new D1WorkflowOutbox(db, { now: () => now })
    await db.query('DELETE FROM Item')
    await db.query('DELETE FROM _zebric_workflow_outbox')
  })
  afterAll(async () => {
    await mf?.dispose()
  })
  const enqueue = (id: string = crypto.randomUUID(), event = intent) =>
    queries.transaction(() => queries.enqueueWorkflowEvent(event, id))

  it('commits mutations, receipts, and private event intents atomically', async () => {
    const session = { ...SYSTEM_SESSION, token: 'private-provider-token' } as any
    await queries.transaction(
      async () => {
        await queries.create('Item', { id: 'committed', value: 'new' }, context)
        await queries.enqueueWorkflowEvent({ ...intent, session }, 'atomic-event')
        expect((await db.query('SELECT * FROM _zebric_workflow_outbox')).rows).toEqual([])
        return { ok: true }
      },
      { key: 'atomic-outbox-receipt', fingerprint: 'same' }
    )
    expect((await db.query('SELECT * FROM Item')).rows).toHaveLength(1)
    const { rows } = await db.query<{ event_json: string }>('SELECT event_json FROM _zebric_workflow_outbox')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event_json).not.toContain('private-provider-token')
    await queries.transaction(
      async () => {
        throw new Error('replayed receipt must skip enqueue')
      },
      { key: 'atomic-outbox-receipt', fingerprint: 'same' }
    )
    const deliver = vi.fn(async (event: WorkflowEventIntent) => {
      expect(event.session!.createdAt).toBeInstanceOf(Date)
      expect(event.before!.value).toBe('old')
      expect(event.after!.value).toBe('new')
    })
    expect(await outbox.drain(deliver)).toEqual({ delivered: 1, failed: 0 })
    expect(await outbox.drain(deliver)).toEqual({ delivered: 0, failed: 0 })
    expect(deliver).toHaveBeenCalledOnce()
  })

  it('suppresses intents on rollback and rejects enqueue without a transaction', async () => {
    await expect(queries.enqueueWorkflowEvent(intent)).rejects.toThrow('active transaction')
    await expect(
      queries.transaction(async () => {
        await queries.create('Item', { id: 'rolled-back' }, context)
        await queries.enqueueWorkflowEvent(intent)
        throw new Error('rollback')
      })
    ).rejects.toThrow('rollback')
    expect((await db.query('SELECT * FROM Item')).rows).toEqual([])
    expect((await db.query('SELECT * FROM _zebric_workflow_outbox')).rows).toEqual([])
  })

  it('rolls back the mutation and receipt if the intent insert fails', async () => {
    await enqueue('collision')
    await expect(
      queries.transaction(
        async () => {
          await queries.create('Item', { id: 'must-rollback' }, context)
          await queries.enqueueWorkflowEvent(intent, 'collision')
          return { ok: true }
        },
        { key: 'failed-outbox-receipt', fingerprint: 'same' }
      )
    ).rejects.toThrow()
    expect((await db.query('SELECT * FROM Item')).rows).toEqual([])
    expect(
      (await db.query('SELECT * FROM _zebric_command_receipts WHERE key = ?', ['failed-outbox-receipt'])).rows
    ).toEqual([])
  })

  it('recovers a committed event through a fresh executor after interruption', async () => {
    const definition = {
      ...blueprint,
      workflows: [
        {
          name: 'Child',
          transactional: true,
          retries: 1,
          trigger: { entity: 'Item', event: 'update' },
          steps: [
            {
              type: 'query',
              entity: 'Item',
              action: 'create',
              data: { id: 'recovered-child', value: '{{variables.after.value}}' }
            }
          ]
        }
      ]
    } as any
    const first = new D1WorkflowExecutor(definition, db, queries)
    await queries.transaction(async () => {
      await queries.create('Item', { id: 'parent', value: 'committed' }, context)
      await first.enqueueEntityEvent({ ...intent, after: { id: 'parent', value: 'committed' } })
    })
    // Simulate losing the Worker before it can start delivery.
    const restarted = new D1WorkflowExecutor(definition, db, new WorkersQueryExecutor(db, definition))
    expect(await restarted.deliverPendingEvents()).toEqual({ delivered: 1, failed: 0 })
    expect((await db.query('SELECT value FROM Item WHERE id = ?', ['recovered-child'])).rows).toEqual([
      { value: 'committed' }
    ])
  })

  it('backs off failed deliveries and retries them across instances without exposing errors', async () => {
    await enqueue('retry')
    const deliver = vi.fn().mockRejectedValueOnce(new Error('secret-credential')).mockResolvedValue(undefined)
    expect(await outbox.drain(deliver)).toEqual({ delivered: 0, failed: 1 })
    expect(await outbox.drain(deliver)).toEqual({ delivered: 0, failed: 0 })
    const stored = (await db.query<any>('SELECT * FROM _zebric_workflow_outbox')).rows[0]
    expect(stored.last_error).toBe('Workflow trigger delivery failed')
    expect(stored.delivered_at).toBeNull()
    now += 1001
    expect(await new D1WorkflowOutbox(db, { now: () => now }).drain(deliver)).toEqual({ delivered: 1, failed: 0 })
    expect(deliver.mock.calls.map((call) => call[1])).toEqual(['retry', 'retry'])
  })

  it('allows only one concurrent dispatcher to claim an event', async () => {
    await enqueue('exclusive')
    let started!: () => void
    let finish!: () => void
    const claimed = new Promise<void>((resolve) => {
      started = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      finish = resolve
    })
    const first = outbox.drain(async () => {
      started()
      await blocked
    })
    await claimed
    const deliver = vi.fn()
    expect(await new D1WorkflowOutbox(db, { now: () => now }).drain(deliver)).toEqual({ delivered: 0, failed: 0 })
    expect(deliver).not.toHaveBeenCalled()
    finish()
    expect(await first).toEqual({ delivered: 1, failed: 0 })
  })

  it('renews a live delivery lease while an inline workflow is running', async () => {
    await enqueue('renewed')
    const leaseMs = 300
    let started!: () => void
    let finish!: () => void
    const claimed = new Promise<void>((resolve) => {
      started = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      finish = resolve
    })
    let leaseClock = Date.now() + 1000
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const store = new D1WorkflowOutbox(db, { leaseMs, now: () => leaseClock })
    const running = store.drain(async () => {
      started()
      await blocked
    })
    await claimed
    const initial = (await db.query<any>('SELECT lease_expires_at FROM _zebric_workflow_outbox')).rows[0]
      .lease_expires_at
    try {
      // Advance the lease clock beyond the original deadline, then run a renewal.
      // D1 round trips may take longer than 300ms on a busy CI host.
      leaseClock += leaseMs + 1
      await vi.advanceTimersByTimeAsync(100)
      await expect
        .poll(
          async () =>
            (await db.query<any>('SELECT lease_expires_at FROM _zebric_workflow_outbox')).rows[0].lease_expires_at
        )
        .toBeGreaterThan(initial + leaseMs)
      const second = vi.fn()
      expect(await new D1WorkflowOutbox(db, { now: () => leaseClock }).drain(second)).toEqual({ delivered: 0, failed: 0 })
      expect(second).not.toHaveBeenCalled()
    } finally {
      finish()
      await running
      vi.useRealTimers()
    }
  })

  it('fences an expired dispatcher from clearing its successor lease', async () => {
    await enqueue('fenced')
    let startOld!: () => void
    let finishOld!: () => void
    let startNew!: () => void
    let finishNew!: () => void
    const oldStarted = new Promise<void>((resolve) => {
      startOld = resolve
    })
    const oldBlocked = new Promise<void>((resolve) => {
      finishOld = resolve
    })
    const newStarted = new Promise<void>((resolve) => {
      startNew = resolve
    })
    const newBlocked = new Promise<void>((resolve) => {
      finishNew = resolve
    })
    const old = outbox.drain(async () => {
      startOld()
      await oldBlocked
      throw new Error('old worker failed')
    })
    await oldStarted
    await db.query('UPDATE _zebric_workflow_outbox SET lease_expires_at = 0')
    const successor = new D1WorkflowOutbox(db, { now: () => now }).drain(async () => {
      startNew()
      await newBlocked
    })
    await newStarted
    const token = (await db.query<any>('SELECT lease_token FROM _zebric_workflow_outbox')).rows[0].lease_token
    finishOld()
    await old
    expect((await db.query<any>('SELECT lease_token FROM _zebric_workflow_outbox')).rows[0].lease_token).toBe(token)
    finishNew()
    expect(await successor).toEqual({ delivered: 1, failed: 0 })
  })

  it('deduplicates native child submission after losing the acknowledgement', async () => {
    const backend = provider()
    const definition = {
      ...blueprint,
      workflows: [{ name: 'NativeChild', trigger: { entity: 'Item', event: 'update' }, steps: [] }]
    } as any
    await enqueue('lost-ack')
    const failing = new D1Adapter(await mf.getD1Database('DB'))
    const query = failing.query.bind(failing)
    failing.query = async (sql, params) => {
      if (sql.includes('SET delivered_at =')) throw new Error('Worker interrupted before acknowledgement')
      return query(sql, params) as any
    }
    const first = new D1WorkflowExecutor(definition, failing, queries, {}, backend.binding)
    expect(await first.deliverPendingEvents()).toEqual({ delivered: 0, failed: 1 })
    expect(backend.instances.size).toBe(1)
    await db.query('UPDATE _zebric_workflow_outbox SET available_at = 0')
    const restarted = new D1WorkflowExecutor(
      definition,
      db,
      new WorkersQueryExecutor(db, definition),
      {},
      backend.binding
    )
    expect(await restarted.deliverPendingEvents()).toEqual({ delivered: 1, failed: 0 })
    expect(backend.binding.create).toHaveBeenCalledOnce()
  })

  it('honors retained terminal metadata when the native provider no longer reports the child', async () => {
    const backend = provider()
    const definition = {
      ...blueprint,
      workflows: [{ name: 'RetainedChild', trigger: { entity: 'Item', event: 'update' }, steps: [] }]
    } as any
    await enqueue('retained-child-event')
    const failing = new D1Adapter(await mf.getD1Database('DB'))
    const query = failing.query.bind(failing)
    failing.query = async (sql, params) => {
      if (sql.includes('SET delivered_at =')) throw new Error('Lost acknowledgement')
      return query(sql, params) as any
    }
    await new D1WorkflowExecutor(definition, failing, queries, {}, backend.binding).deliverPendingEvents()
    const [id] = backend.instances.keys()
    await db.query(
      "UPDATE _zebric_workflow_jobs SET job_json = json_set(job_json, '$.status', 'completed') WHERE id = ?",
      [id]
    )
    backend.instances.delete(id)
    await db.query('UPDATE _zebric_workflow_outbox SET available_at = 0')
    const restarted = new D1WorkflowExecutor(definition, db, queries, {}, backend.binding)
    expect(await restarted.deliverPendingEvents()).toEqual({ delivered: 1, failed: 0 })
    expect(backend.binding.create).toHaveBeenCalledOnce()
    expect(backend.instances.size).toBe(0)
  })

  it('replays a transactional inline child after losing the delivery acknowledgement', async () => {
    const definition = {
      ...blueprint,
      workflows: [
        {
          name: 'InlineChild',
          transactional: true,
          retries: 1,
          trigger: { entity: 'Item', event: 'update' },
          steps: [{ type: 'query', entity: 'Item', action: 'create', data: { id: 'inline-child', value: 'once' } }]
        }
      ]
    } as any
    await enqueue('inline-lost-ack')
    const failing = new D1Adapter(await mf.getD1Database('DB'))
    const query = failing.query.bind(failing)
    failing.query = async (sql, params) => {
      if (sql.includes('SET delivered_at =')) throw new Error('Lost acknowledgement')
      return query(sql, params) as any
    }
    expect(await new D1WorkflowExecutor(definition, failing, queries).deliverPendingEvents()).toEqual({
      delivered: 0,
      failed: 1
    })
    await db.query('UPDATE _zebric_workflow_outbox SET available_at = 0')
    const restarted = new D1WorkflowExecutor(definition, db, new WorkersQueryExecutor(db, definition))
    expect(await restarted.deliverPendingEvents()).toEqual({ delivered: 1, failed: 0 })
    expect((await restarted.getJobs({ workflowName: 'InlineChild' }))[0].status).toBe('completed')
    expect((await db.query('SELECT * FROM Item WHERE id = ?', ['inline-child'])).rows).toHaveLength(1)
  })

  it('retries fanout without resubmitting the children already accepted', async () => {
    const backend = provider()
    const create = backend.binding.create.getMockImplementation()!
    let failed = false
    backend.binding.create.mockImplementation(async (options: any) => {
      if (options.params.workflow.name === 'Second' && !failed) {
        failed = true
        throw new Error('provider unavailable')
      }
      return create(options)
    })
    const definition = {
      ...blueprint,
      workflows: ['First', 'Second'].map((name) => ({ name, trigger: { entity: 'Item', event: 'update' }, steps: [] }))
    } as any
    await enqueue('fanout')
    const executor = new D1WorkflowExecutor(definition, db, queries, {}, backend.binding)
    expect(await executor.deliverPendingEvents()).toEqual({ delivered: 0, failed: 1 })
    await db.query('UPDATE _zebric_workflow_outbox SET available_at = 0')
    expect(await executor.deliverPendingEvents()).toEqual({ delivered: 1, failed: 0 })
    expect(backend.instances.size).toBe(2)
    expect(
      backend.binding.create.mock.calls.filter((call: any) => call[0].params.workflow.name === 'First')
    ).toHaveLength(1)
  })

  it('processes newly queued child events without recursive drains', async () => {
    // Keep the offset clock advancing as child transactions take real time.
    outbox = new D1WorkflowOutbox(db, { now: () => Date.now() + 1000 })
    await enqueue('parent-event')
    const deliver = vi.fn(async (_event: WorkflowEventIntent, id: string) => {
      if (id === 'parent-event') {
        await enqueue('child-event')
        expect(
          await outbox.drain(async () => {
            throw new Error('must not recurse')
          })
        ).toEqual({ delivered: 0, failed: 0 })
      }
    })
    expect(await outbox.drain(deliver)).toEqual({ delivered: 2, failed: 0 })
    expect(deliver).toHaveBeenCalledTimes(2)
  })
})
