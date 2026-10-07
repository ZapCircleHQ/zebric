import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { CommandExecutor, SYSTEM_SESSION, type Blueprint } from '@zebric/runtime-core'
import { DatabaseConnection } from '../database/connection.js'
import { NodeCommandEffects } from '../database/command-effects.js'
import { AgentEventBus } from '../engine/agent-event-bus.js'
import { AuditLogger } from '../security/audit-logger.js'
import { QueryExecutor } from '../database/query-executor.js'
import { drainAuditOutbox } from '../engine/subsystem-initializer.js'
import { registerCommandRoutes, registerWorkflowJobRoutes } from '../engine/server-routes.js'
import { WorkflowStore, WorkflowLeaseLostError, WorkflowSuspended } from './workflow-store.js'
import { DurableStepRunner } from './step-runner.js'
import { WorkflowExecutor } from './workflow-executor.js'
import { WorkflowManager } from './workflow-manager.js'
import type { Workflow, WorkflowJob } from './types.js'

const blueprint: Blueprint = {
  version: '1.0.0',
  project: { name: 'Durable workflows', version: '1.0.0', runtime: { min_version: '0.3.0' } },
  entities: [
    {
      name: 'Item',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true, required: true },
        { name: 'value', type: 'Text', required: true }
      ]
    }
  ],
  pages: []
}
const workflow: Workflow = { name: 'test', trigger: { manual: true }, steps: [], retries: 2 }
const initial = (id = 'job'): WorkflowJob => ({
  id,
  workflowName: 'test',
  status: 'pending',
  attempts: 0,
  createdAt: new Date(),
  context: { trigger: { type: 'manual' }, variables: {}, session: SYSTEM_SESSION }
})
let root: string
const connections: DatabaseConnection[] = []
const managers: WorkflowManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown(0)))
  await Promise.all(connections.splice(0).map((connection) => connection.close()))
  if (root) await rm(root, { recursive: true, force: true })
})
async function open() {
  root ??= await mkdtemp(join(tmpdir(), 'zebric-workflows-'))
  // A new root is assigned by setup for each test; reopening keeps the same file.
  const connection = new DatabaseConnection({ type: 'sqlite', filename: join(root, 'app.db') }, blueprint)
  await connection.connect()
  connections.push(connection)
  return new QueryExecutor(connection)
}
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'zebric-workflows-'))
  return open()
}
async function until(predicate: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for durable workflow')
}

describe('Node durable workflows on real SQLite', () => {
  it('replays committed typed receipts after reopening and rejects conflicting input', async () => {
    const db = await setup()
    const receipt = { key: 'command:user:1', fingerprint: 'original' }
    const value = { at: new Date('2025-01-01'), values: [true, 3, undefined, { nested: 'yes' }] }
    await db.transaction(async () => {
      await db.create('Item', { value: 'once' })
      return value
    }, receipt)
    await connections.pop()!.close()
    const reopened = await open()
    const call = vi.fn()
    expect(await reopened.transaction(call, receipt)).toEqual(value)
    expect(call).not.toHaveBeenCalled()
    expect(await reopened.execute({ entity: 'Item' })).toHaveLength(1)
    await expect(reopened.transaction(call, { ...receipt, fingerprint: 'changed' })).rejects.toThrow('Idempotency')
  })

  it('rolls back both mutations and receipts on failure', async () => {
    const db = await setup()
    await expect(
      db.transaction(
        async () => {
          await db.create('Item', { value: 'rollback' })
          throw new Error('failure')
        },
        { key: 'failed', fingerprint: 'f' }
      )
    ).rejects.toThrow('failure')
    expect(await db.execute({ entity: 'Item' })).toHaveLength(0)
    expect(await db.queryRuntime(sql`SELECT * FROM __zbl_command_receipts`)).toHaveLength(0)
  })

  it('serializes concurrent receipt submissions and applies a mutation once', async () => {
    const db = await setup()
    const effect = vi.fn(async () => db.create('Item', { value: 'once' }))
    const results = await Promise.all(
      Array.from({ length: 10 }, () => db.transaction(effect, { key: 'same', fingerprint: 'f' }))
    )
    expect(effect).toHaveBeenCalledTimes(1)
    expect(new Set(results.map((result) => result.id)).size).toBe(1)
  })

  it('fences expired owners across independent database connections', async () => {
    let now = 1000
    const one = new WorkflowStore(await setup(), 100, () => now)
    const two = new WorkflowStore(await open(), 100, () => now)
    await one.create(initial(), workflow)
    const first = (await one.claim(['test']))!
    expect(await two.claim(['test'])).toBeUndefined()
    now += 101
    const second = (await two.claim(['test']))!
    await expect(one.saveCheckpoint(first.job, 'stale', true)).rejects.toBeInstanceOf(WorkflowLeaseLostError)
    expect(await one.finish(first.job, 'completed')).toBe(false)
    await two.saveCheckpoint(second.job, 'fresh', true)
    expect(await two.finish(second.job, 'completed')).toBe(true)
  })

  it('resumes a saved delay and restores typed results without repeating effects after restart', async () => {
    let now = 1000
    const db = await setup()
    const store = new WorkflowStore(db, 100, () => now)
    const typed = { date: new Date('2025-02-01'), enabled: true, array: [1, { x: 2 }], empty: undefined }
    const invokeAction = vi.fn(async (_plugin: string, _action: string, _params: any) => typed)
    const definition: Workflow = {
      ...workflow,
      steps: [
        { type: 'plugin', plugin: 'test', action_name: 'make', assignTo: 'typed' },
        { type: 'delay', duration: 500 },
        { type: 'plugin', plugin: 'test', action_name: 'consume', params: { value: '{{variables.typed}}' } }
      ]
    }
    await store.create(initial(), definition)
    const claimed = (await store.claim(['test']))!
    const executor = new WorkflowExecutor({
      dataLayer: db,
      pluginRegistry: {
        getPlugin: (plugin: string) => ({
          actions: Object.fromEntries(
            ['make', 'consume', 'success', 'fail'].map((action) => [
              action,
              (params: any) => invokeAction(plugin, action, params)
            ])
          )
        })
      }
    })
    await expect(
      executor.execute(definition, claimed.job.context, {
        runner: new DurableStepRunner(store, claimed.job, definition, new AbortController().signal)
      })
    ).rejects.toBeInstanceOf(WorkflowSuspended)
    await store.finish(claimed.job, 'pending', undefined, 1500)
    await connections.pop()!.close()
    const reopened = await open()
    const recoveredStore = new WorkflowStore(reopened, 100, () => now)
    expect(await recoveredStore.claim(['test'])).toBeUndefined()
    now = 1500
    const recovered = (await recoveredStore.claim(['test']))!
    const recoveredExecutor = new WorkflowExecutor({
      dataLayer: reopened,
      pluginRegistry: {
        getPlugin: (plugin: string) => ({
          actions: Object.fromEntries(
            ['make', 'consume', 'success', 'fail'].map((action) => [
              action,
              (params: any) => invokeAction(plugin, action, params)
            ])
          )
        })
      }
    })
    expect(
      (
        await recoveredExecutor.execute(definition, recovered.job.context, {
          runner: new DurableStepRunner(recoveredStore, recovered.job, definition, new AbortController().signal)
        })
      ).success
    ).toBe(true)
    expect(invokeAction).toHaveBeenCalledTimes(2)
    expect(invokeAction.mock.calls[1]).toEqual(['test', 'consume', { value: typed }])
  })

  it('persists retry backoff and does not retry earlier successful steps', async () => {
    let now = 1000
    const db = await setup()
    const store = new WorkflowStore(db, 100, () => now)
    const invokeAction = vi.fn(async (_plugin: string, action: string, _params: any) => {
      if (action === 'fail') throw new Error('private failure')
      return true
    })
    const definition: Workflow = {
      ...workflow,
      steps: [
        { type: 'plugin', plugin: 'test', action_name: 'success' },
        { type: 'plugin', plugin: 'test', action_name: 'fail' }
      ]
    }
    await store.create(initial(), definition)
    const first = (await store.claim(['test']))!
    const executor = new WorkflowExecutor({
      dataLayer: db,
      pluginRegistry: {
        getPlugin: (plugin: string) => ({
          actions: Object.fromEntries(
            ['make', 'consume', 'success', 'fail'].map((action) => [
              action,
              (params: any) => invokeAction(plugin, action, params)
            ])
          )
        })
      }
    })
    await expect(
      executor.execute(definition, first.job.context, {
        runner: new DurableStepRunner(store, first.job, definition, new AbortController().signal, 100)
      })
    ).rejects.toBeInstanceOf(WorkflowSuspended)
    await store.finish(first.job, 'pending', undefined, 1100)
    expect(await store.claim(['test'])).toBeUndefined()
    await connections.pop()!.close()
    now = 1100
    const reopened = await open()
    const recoveredStore = new WorkflowStore(reopened, 100, () => now)
    const recovered = (await recoveredStore.claim(['test']))!
    const result = await new WorkflowExecutor({
      dataLayer: reopened,
      pluginRegistry: {
        getPlugin: (plugin: string) => ({
          actions: Object.fromEntries(
            ['make', 'consume', 'success', 'fail'].map((action) => [
              action,
              (params: any) => invokeAction(plugin, action, params)
            ])
          )
        })
      }
    }).execute(definition, recovered.job.context, {
      runner: new DurableStepRunner(recoveredStore, recovered.job, definition, new AbortController().signal, 100)
    })
    expect(result.success).toBe(false)
    expect(invokeAction.mock.calls.map((call) => call[1])).toEqual(['success', 'fail', 'fail'])
    expect((await recoveredStore.checkpoint(recovered.job, 'steps.1')).attempts).toBe(2)
  })

  it('rolls back timed-out database effects and rejects late writes from their closed transaction', async () => {
    const db = await setup()
    const store = new WorkflowStore(db)
    const definition = { ...workflow, retries: 1, timeout: 10 }
    await store.create(initial(), definition)
    const { job } = (await store.claim(['test']))!
    const runner = new DurableStepRunner(store, job, definition, new AbortController().signal)
    let late: Promise<void> | undefined
    let release!: () => void
    await expect(
      runner.run(
        'effect',
        async () => {
          await db.create('Item', { value: 'rolled back' })
          await new Promise<void>((resolve) => {
            release = resolve
          })
          late = db.create('Item', { value: 'late' }).then(() => undefined)
          await late
        },
        { atomic: true }
      )
    ).rejects.toThrow('timed out')
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(late).rejects.toThrow(/no longer active|timed out/)
    expect(await db.execute({ entity: 'Item' })).toEqual([])
    expect((await store.checkpoint(job, 'effect')).found).toBe(false)
  })

  it('commits database effects, their checkpoints and event intents together', async () => {
    const db = await setup()
    const store = new WorkflowStore(db)
    await store.create(initial(), workflow)
    const { job } = (await store.claim(['test']))!
    const runner = new DurableStepRunner(store, job, workflow, new AbortController().signal)
    const effect = vi.fn(async () => {
      const after = await db.create('Item', { value: 'created' })
      await store.enqueueEvent({ entity: 'Item', event: 'create', after }, 'event')
      return after
    })
    const first = await runner.run('create', effect, { atomic: true })
    expect(await runner.run('create', effect, { atomic: true })).toEqual(first)
    expect(effect).toHaveBeenCalledTimes(1)
    expect(await db.queryRuntime(sql`SELECT * FROM __zbl_workflow_events`)).toHaveLength(1)
  })

  it('keeps mutation trigger intents atomic and recovers them into persistent child jobs', async () => {
    const db = await setup()
    const manager = new WorkflowManager({ dataLayer: db })
    managers.push(manager)
    manager.registerWorkflow({ name: 'child', trigger: { entity: 'Item', event: 'create' }, steps: [] })
    await expect(
      db.transaction(async () => {
        await db.create('Item', { value: 'rollback' })
        throw new Error('abort')
      })
    ).rejects.toThrow()
    expect(await db.queryRuntime(sql`SELECT * FROM __zbl_workflow_events`)).toHaveLength(0)
    await db.create('Item', { value: 'committed' })
    await manager.deliverPendingEvents()
    const store = new WorkflowStore(db)
    expect((await store.list()).filter((job) => job.workflowName === 'child')).toHaveLength(1)
    const event = (await db.queryRuntime<{ id: string }>(sql`SELECT id FROM __zbl_workflow_events`))[0]!
    // Simulate delivery succeeded but acknowledgement was lost.
    await db.queryRuntime(sql`UPDATE __zbl_workflow_events SET delivered_at = NULL WHERE id = ${event.id}`)
    await manager.deliverPendingEvents()
    expect(await store.list()).toHaveLength(1)
  })

  it('rejects unrestricted effects inside a transactional workflow at registration', async () => {
    const manager = new WorkflowManager({ dataLayer: await setup() })
    managers.push(manager)
    expect(() =>
      manager.registerWorkflow({
        ...workflow,
        transactional: true,
        steps: [{ type: 'plugin', plugin: 'test', action_name: 'external' }]
      })
    ).toThrow('database-only')
  })

  it('persists API-visible jobs across managers and enforces owner access to polling and controls', async () => {
    const db = await setup()
    const owner = { id: 'session', user: { id: 'owner' } }
    let manager = new WorkflowManager({ dataLayer: db })
    managers.push(manager)
    manager.registerWorkflow({ ...workflow, steps: [{ type: 'delay', duration: 100000 }] })
    const job = manager.trigger('test', { session: owner }, { submission: { scope: 'owner:key', fingerprint: 'same' } })
    await manager.ensurePersisted(job.id)
    await until(
      async () =>
        (await new WorkflowStore(db).checkpoint((await new WorkflowStore(db).get(job.id))!, 'steps.0')).wakeAt !==
        undefined
    )
    await manager.shutdown(0)
    managers.pop()
    manager = new WorkflowManager({ dataLayer: db })
    managers.push(manager)
    manager.registerWorkflow(workflow)
    expect(
      (await manager.ensurePersisted(
        manager.trigger(
          'test',
          { session: owner },
          {
            submission: { scope: 'owner:key', fingerprint: 'same' }
          }
        ).id
      ))!.id
    ).toBe(job.id)
    const app = new Hono()
    let session = owner
    registerWorkflowJobRoutes(app, {
      workflowManager: manager,
      sessionManager: { getSession: async () => session } as any,
      apiKeys: new Map()
    })
    expect((await app.request(`/api/jobs/${job.id}`)).status).toBe(200)
    session = { ...owner, user: { id: 'other' } }
    expect((await app.request(`/api/jobs/${job.id}/cancel`, { method: 'POST' })).status).toBe(404)
    session = owner
    expect((await app.request(`/api/jobs/${job.id}/cancel`, { method: 'POST' })).status).toBe(200)
    expect((await manager.getDurableJob(job.id))!.status).toBe('cancelled')
    expect((await app.request(`/api/jobs/${job.id}/retry`, { method: 'POST' })).status).toBe(409)
  })
  it('replays HTTP command responses after reopening without repeating the command or its effects', async () => {
    let db = await setup()
    const commandBlueprint: Blueprint = {
      ...blueprint,
      commands: [
        {
          name: 'FinishItem',
          entity: 'Item',
          policy: 'record.value == "pending"',
          input: { note: { type: 'Text' } },
          mutations: { value: 'finished' }
        }
      ]
    }
    const item = await db.create('Item', { value: 'pending' })
    const session = { id: 'session', user: { id: 'owner' } }
    const configure = () => {
      const bus = new AgentEventBus()
      const effects = new NodeCommandEffects(db, bus, new AuditLogger({ logPath: join(root, 'audit.log') }))
      const command = new CommandExecutor(commandBlueprint, { queryExecutor: db, commandEffects: effects })
      const app = new Hono()
      registerCommandRoutes(app, {
        blueprint: commandBlueprint,
        queryExecutor: db,
        commandExecutor: command,
        sessionManager: { getSession: async () => session } as any,
        apiKeys: new Map()
      })
      return app
    }
    const request = (app: Hono, note = 'same') =>
      app.request(`/api/commands/finish_item/${item.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'finish' },
        body: JSON.stringify({ note })
      })
    const response = await request(configure())
    expect(response.status).toBe(200)
    const saved = await response.text()
    await connections.pop()!.close()
    db = await open()
    const app = configure()
    const replay = await request(app)
    expect(replay.status).toBe(200)
    expect(await replay.text()).toBe(saved)
    expect((await request(app, 'changed')).status).toBe(409)
    expect(await db.queryRuntime(sql`SELECT * FROM __zbl_audit_outbox WHERE topic = 'domain.command'`)).toHaveLength(1)
    expect(await db.queryRuntime(sql`SELECT * FROM __zbl_command_events`)).toHaveLength(1)
  })

  it('recovers command audit and event delivery and deduplicates an unacknowledged audit append', async () => {
    const db = await setup()
    const bus = new AgentEventBus()
    const received = vi.fn()
    bus.subscribe(received)
    const audit = new AuditLogger({ logPath: join(root, 'audit.log') })
    const effects = new NodeCommandEffects(db, bus, audit)
    const write = vi.spyOn(audit, 'log').mockReturnValueOnce(false)
    const payload = {
      audit: [{ eventType: 'domain.command', action: 'FinishItem', entityType: 'Item', entityId: 'item' }],
      events: [
        {
          name: 'finished',
          entity: 'Item',
          recordId: 'item',
          command: 'FinishItem',
          actor: { id: 'owner', type: 'user' as const, roles: [], scopes: [] },
          occurredAt: new Date().toISOString()
        }
      ]
    }
    await expect(
      db.transaction(async () => {
        await effects.enqueue(payload)
        throw new Error('abort')
      })
    ).rejects.toThrow()
    expect(await db.listPendingAuditOutbox()).toEqual([])
    expect(await db.queryRuntime(sql`SELECT * FROM __zbl_command_events`)).toEqual([])
    await db.transaction(() => effects.enqueue(payload))
    expect(received).not.toHaveBeenCalled()
    expect(await db.listPendingAuditOutbox()).toHaveLength(1)
    await effects.drain()
    expect(received).toHaveBeenCalledTimes(1)
    const auditId = (await db.queryRuntime<{ id: string }>(sql`SELECT id FROM __zbl_audit_outbox`))[0]!.id
    await db.queryRuntime(sql`UPDATE __zbl_audit_outbox SET delivered_at = NULL WHERE id = ${auditId}`)
    await effects.drain()
    expect(audit.query({ entityType: 'Item', entityId: 'item' })).toHaveLength(1)
    write.mockRestore()
  })

  it('rolls back an entire transactional workflow including its audit and event intents', async () => {
    const db = await setup()
    const store = new WorkflowStore(db)
    const definition: Workflow = {
      ...workflow,
      transactional: true,
      retries: 1,
      steps: [
        { type: 'query', entity: 'Item', action: 'create', data: { id: 'duplicate', value: 'first' } },
        { type: 'query', entity: 'Item', action: 'create', data: { id: 'duplicate', value: 'second' } }
      ]
    }
    await store.create(initial(), definition)
    const { job } = (await store.claim(['test']))!
    const executor = new WorkflowExecutor({
      dataLayer: db,
      enqueueEntityEvent: (event, id) => store.enqueueEvent(event, id)
    })
    const result = await executor.execute(definition, job.context, {
      runner: new DurableStepRunner(store, job, definition, new AbortController().signal),
      beforeTransactionalCommit: () =>
        db.enqueueAuditOutbox({ id: 'completed', topic: 'workflow.completed', payload: '{}', createdAt: 1 })
    })
    expect(result.success).toBe(false)
    expect(await db.execute({ entity: 'Item' })).toEqual([])
    expect(await db.listPendingAuditOutbox()).toEqual([])
    expect(await db.queryRuntime(sql`SELECT * FROM __zbl_workflow_events`)).toEqual([])
    expect(await db.queryRuntime(sql`SELECT * FROM __zbl_command_receipts`)).toEqual([])
  })

  it('replays a committed transaction on explicit retry using its durable receipt', async () => {
    const db = await setup()
    const store = new WorkflowStore(db)
    const definition: Workflow = {
      ...workflow,
      transactional: true,
      steps: [
        { type: 'query', entity: 'Item', action: 'create', data: { value: 'once' }, assignTo: 'created' },
        {
          type: 'condition',
          if: { 'variables.created.value': 'once' },
          then: [{ type: 'query', entity: 'Item', action: 'find', assignTo: 'rows' }]
        }
      ]
    }
    await store.create(initial(), definition)
    let claimed = (await store.claim(['test']))!
    const executor = new WorkflowExecutor({
      dataLayer: db,
      enqueueEntityEvent: (event, id) => store.enqueueEvent(event, id)
    })
    const execute = () =>
      executor.execute(definition, claimed.job.context, {
        runner: new DurableStepRunner(store, claimed.job, definition, new AbortController().signal),
        beforeTransactionalCommit: () =>
          db.enqueueAuditOutbox({ id: 'completed', topic: 'workflow.completed', payload: '{}', createdAt: 1 })
      })
    const first = await execute()
    expect(first.success).toBe(true)
    await store.finish(claimed.job, 'failed')
    expect(await store.retry(claimed.job.id)).toBe(true)
    claimed = (await store.claim(['test']))!
    const replay = await execute()
    expect(replay.result).toEqual(first.result)
    expect(await db.execute({ entity: 'Item' })).toHaveLength(1)
    expect(await db.listPendingAuditOutbox()).toHaveLength(1)
    expect(await db.queryRuntime(sql`SELECT * FROM __zbl_workflow_events`)).toHaveLength(1)
  })

  it('aborts an uncooperative external step on cancellation and fences its later database writes', async () => {
    const db = await setup()
    const store = new WorkflowStore(db)
    await store.create(initial(), workflow)
    const { job } = (await store.claim(['test']))!
    const controller = new AbortController()
    const runner = new DurableStepRunner(store, job, workflow, controller.signal)
    let release!: () => void
    let late: Promise<any> | undefined
    const running = runner.run('external', async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      late = db.create('Item', { value: 'late' })
      await late
    })
    await until(async () => Boolean(release))
    expect(await store.cancel(job.id)).toBe(true)
    controller.abort(new Error('cancelled'))
    await expect(running).rejects.toThrow('cancelled')
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(late).rejects.toThrow('cancelled')
    expect(await db.execute({ entity: 'Item' })).toEqual([])
  })
  it('keeps startup recovery paused until the engine has configured its command executor', async () => {
    const db = await setup()
    const commandBlueprint: Blueprint = {
      ...blueprint,
      commands: [{ name: 'FinishItem', entity: 'Item', mutations: { value: 'finished' } }]
    }
    const item = await db.create('Item', { value: 'pending' })
    const definition: Workflow = { ...workflow, steps: [{ type: 'command', command: 'FinishItem', recordId: item.id }] }
    const store = new WorkflowStore(db)
    await store.create(initial(), definition)
    const manager = new WorkflowManager({ dataLayer: db, startPaused: true })
    managers.push(manager)
    manager.registerWorkflow(definition)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect((await store.get('job'))!.status).toBe('pending')
    expect((await store.get('job'))!.attempts).toBe(0)
    manager.setCommandExecutor(new CommandExecutor(commandBlueprint, { queryExecutor: db }))
    manager.start()
    await until(async () => (await store.get('job'))!.status === 'completed')
    expect((await db.findById('Item', item.id)).value).toBe('finished')
  })

  it('saves nontransactional outcome audits with terminal job state', async () => {
    const db = await setup()
    const manager = new WorkflowManager({
      dataLayer: db,
      enqueueOutcomeAudit: async (job, _workflow, success) => {
        await db.enqueueAuditOutbox({
          id: `outcome:${job.id}`,
          topic: success ? 'workflow.completed' : 'workflow.failed',
          payload: JSON.stringify({ success }),
          createdAt: Date.now()
        })
      }
    })
    managers.push(manager)
    manager.registerWorkflow(workflow)
    const job = manager.trigger('test')
    await manager.ensurePersisted(job.id)
    await until(async () => (await manager.getDurableJob(job.id))?.status === 'completed')
    expect(await db.listPendingAuditOutbox()).toEqual([expect.objectContaining({ id: `outcome:${job.id}` })])
  })

  it('skips disabled triggers and keeps durable submission deduplication during cleanup', async () => {
    const db = await setup()
    const store = new WorkflowStore(db)
    const manager = new WorkflowManager({ dataLayer: db })
    managers.push(manager)
    manager.registerWorkflow({ ...workflow, enabled: false, trigger: { entity: 'Item', event: 'create' } })
    await db.create('Item', { value: 'trigger' })
    await manager.deliverPendingEvents()
    expect(await store.list()).toEqual([])
    await store.create(initial(), workflow, 'keyed')
    const claimed = (await store.claim(['test']))!
    await store.finish(claimed.job, 'completed')
    expect(await store.cleanup(Date.now() + 1)).toBe(0)
    expect(await store.create(initial(), workflow, 'keyed')).toMatchObject({ status: 'completed' })
  })
  it('keeps prior audit intents pending when auditing is disabled while still delivering command events', async () => {
    const db = await setup()
    const audit = new AuditLogger({ enabled: false, logPath: join(root, 'audit.log') })
    await db.transaction(() =>
      db.enqueueAuditOutbox({ id: 'prior', topic: 'domain.command', payload: '{}', createdAt: 1 })
    )
    const bus = new AgentEventBus()
    const received = vi.fn()
    bus.subscribe(received)
    const effects = new NodeCommandEffects(db, bus, audit)
    await db.transaction(() =>
      effects.enqueue({
        audit: [{ eventType: 'domain.command', action: 'FinishItem' }],
        events: [
          {
            name: 'finished',
            entity: 'Item',
            recordId: 'item',
            command: 'FinishItem',
            actor: { id: 'owner', type: 'user', roles: [], scopes: [] },
            occurredAt: new Date().toISOString()
          }
        ]
      })
    )
    await drainAuditOutbox(db, audit)
    expect(await db.listPendingAuditOutbox()).toEqual([expect.objectContaining({ id: 'prior' })])
    expect(received).toHaveBeenCalledTimes(1)
  })
})
