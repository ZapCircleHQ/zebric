import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Miniflare } from 'miniflare'
import { CommandExecutor, SYSTEM_SESSION, type Blueprint, type UserSession } from '@zebric/runtime-core'
import { D1Adapter } from '../../src/database/d1-adapter.js'
import { D1RuntimeJournal } from '../../src/audit/d1-runtime-journal.js'
import { WorkersQueryExecutor } from '../../src/query/workers-query-executor.js'
import { ZebricWorkersEngine } from '../../src/engine.js'
import { D1WorkflowExecutor } from '../../src/workflows/d1-workflow-executor.js'

const blueprint = {
  version: '1',
  project: { name: 'Journal', version: '1', runtime: { min_version: '0.6.3' } },
  pages: [],
  entities: [
    {
      name: 'Item',
      fields: [
        { name: 'id', type: 'ULID', primary_key: true },
        { name: 'ownerId', type: 'Text' },
        { name: 'value', type: 'Text' },
        { name: 'private', type: 'Text', access: { read: false, write: true } },
        { name: 'password', type: 'Text' }
      ],
      access: {
        read: { ownerId: '$currentUser.id' },
        create: 'authenticated',
        update: { ownerId: '$currentUser.id' },
        delete: 'authenticated'
      }
    }
  ],
  commands: [
    {
      name: 'Change',
      entity: 'Item',
      policy: 'record.ownerId == actor.effectiveId',
      input: { value: { type: 'Text', required: true } },
      mutations: { value: 'input.value' }
    }
  ]
} as unknown as Blueprint
const makeSession = (id: string, extra: Partial<UserSession> = {}): UserSession => ({
  id: `session-${id}`,
  userId: id,
  user: { id, email: `${id}@example.test` },
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60000),
  ...extra
})
const owner = makeSession('owner')
const other = makeSession('other')
const agent = makeSession('owner', {
  actor: { id: 'owner', type: 'agent', credentialId: 'agent-one', roles: [], scopes: ['*'] }
})
const agentTwo = makeSession('owner', {
  actor: { id: 'owner', type: 'agent', credentialId: 'agent-two', roles: [], scopes: ['*'] }
})
const limited = makeSession('owner', {
  actor: { id: 'owner', type: 'agent', credentialId: 'limited', roles: [], scopes: [] }
})
const sessions: Record<string, UserSession> = { owner, other, agent, agentTwo, limited }

describe('Workers transactional audit history and durable events', () => {
  let mf: Miniflare
  let binding: D1Database
  let db: D1Adapter
  let journal: D1RuntimeJournal
  let queries: WorkersQueryExecutor
  let commands: CommandExecutor
  const engine = () =>
    new ZebricWorkersEngine({
      env: { DB: binding },
      blueprint,
      sessionManager: {
        getSession: async (request) =>
          sessions[request.headers.get('authorization')?.replace('Bearer ', '') ?? ''] ?? null
      } as any
    })
  const request = (path: string, token?: string, init: RequestInit = {}) =>
    new Request(`https://edge.example${path}`, {
      ...init,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers }
    })
  const change = (token = 'owner', key = crypto.randomUUID()) =>
    engine().fetch(
      request('/api/commands/change/item', token, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
          'x-agent-run-id': 'run-1',
          cookie: 'csrf-token=test',
          'x-csrf-token': 'test'
        },
        body: JSON.stringify({ value: 'changed' })
      })
    )

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-04-28',
      d1Databases: { DB: 'runtime-journal' }
    })
    binding = await mf.getD1Database('DB')
    db = new D1Adapter(binding)
    await db.query('CREATE TABLE Item (id TEXT PRIMARY KEY, ownerId TEXT, value TEXT, private TEXT, password TEXT)')
    journal = new D1RuntimeJournal(db)
    await journal.latestSequence()
    queries = new WorkersQueryExecutor(db, blueprint, { auditMutations: true })
    commands = new CommandExecutor(blueprint, {
      queryExecutor: queries,
      commandEffects: { enqueue: (effects) => queries.enqueueCommandEffects(effects) }
    })
  })
  beforeEach(async () => {
    await db.query('DELETE FROM Item')
    await db.query('DELETE FROM _zebric_audit')
    await db.query('DELETE FROM _zebric_domain_events')
    await db.query(
      'CREATE TABLE IF NOT EXISTS _zebric_command_receipts (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, value TEXT NOT NULL)'
    )
    await db.query('DELETE FROM _zebric_command_receipts')
    await db.query("INSERT INTO Item VALUES ('item', 'owner', 'old', 'private-value', 'password-value')")
  })
  afterAll(async () => {
    await mf?.dispose()
  })

  it('commits commands, audit, domain events and receipts together and replays without duplicates', async () => {
    const operation = () =>
      commands.execute({ command: 'Change', recordId: 'item', input: { value: 'atomic' }, context: { session: owner } })
    const first = await queries.transaction(operation, { key: 'receipt', fingerprint: 'same' })
    const replay = await queries.transaction(
      () => {
        throw new Error('must not rerun')
      },
      { key: 'receipt', fingerprint: 'same' }
    )
    expect(replay).toEqual(first)
    expect(await journal.queryAudit({ entity: 'Item', recordId: 'item' })).toMatchObject([
      { eventType: 'domain.command', actorId: 'owner', metadata: { mutation: { value: 'atomic' } } }
    ])
    const events = await journal.queryEvents('actor:user:owner', 0)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'domain.Change', subject: 'Item:item', data: { command: 'Change' } })
    expect(events[0].data).not.toHaveProperty('value')
  })

  it('does not expose staged history or events and rolls everything back on error', async () => {
    await expect(
      queries.transaction(
        async () => {
          await commands.execute({
            command: 'Change',
            recordId: 'item',
            input: { value: 'rollback' },
            context: { session: owner }
          })
          expect(await journal.queryAudit({ entity: 'Item', recordId: 'item' })).toEqual([])
          expect(await journal.queryEvents('actor:user:owner', 0)).toEqual([])
          throw new Error('abort')
        },
        { key: 'rollback', fingerprint: 'same' }
      )
    ).rejects.toThrow('abort')
    expect((await db.query('SELECT value FROM Item')).rows[0]).toEqual({ value: 'old' })
    expect(await journal.queryAudit({ entity: 'Item', recordId: 'item' })).toEqual([])
    expect(await journal.queryEvents('actor:user:owner', 0)).toEqual([])
    expect((await db.query('SELECT * FROM _zebric_command_receipts')).rows).toEqual([])
  })

  it('rolls back the mutation if journal persistence fails during the atomic commit', async () => {
    const batch = db.batch.bind(db)
    const spy = vi.spyOn(db, 'batch').mockImplementation(async (statements) => {
      const writes = statements.some((statement) => /INSERT INTO _zebric_audit/.test(statement.sql))
      return batch(writes ? [...statements, { sql: 'INSERT INTO missing_table VALUES (1)' }] : statements)
    })
    try {
      await expect(
        commands.execute({
          command: 'Change',
          recordId: 'item',
          input: { value: 'not committed' },
          context: { session: owner }
        })
      ).rejects.toThrow()
      expect((await db.query('SELECT value FROM Item')).rows[0]).toEqual({ value: 'old' })
      expect(await journal.queryEvents('actor:user:owner', 0)).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })

  it('records CRUD writes, preserves rollback and strips secret values in stored history', async () => {
    const created = await queries.create(
      'Item',
      { id: 'crud', ownerId: 'owner', value: 'new', password: 'never-log-me' },
      { session: SYSTEM_SESSION }
    )
    await queries.update('Item', created.id, { value: 'updated', private: 'hidden' }, { session: SYSTEM_SESSION })
    await queries.delete('Item', created.id, { session: SYSTEM_SESSION })
    const history = await journal.queryAudit({ entity: 'Item', recordId: created.id })
    expect(history.map((entry) => entry.eventType)).toEqual(['data.delete', 'data.update', 'data.create'])
    expect(JSON.stringify(history)).not.toContain('never-log-me')
    await expect(
      queries.transaction(async () => {
        await queries.create('Item', { id: 'aborted', ownerId: 'owner' }, { session: SYSTEM_SESSION })
        throw new Error('abort')
      })
    ).rejects.toThrow('abort')
    expect(await journal.queryAudit({ entity: 'Item', recordId: 'aborted' })).toEqual([])
  })

  it('serves authorized history across engine restarts and enforces entity scopes and filters', async () => {
    expect((await change('owner', 'http-replay')).status).toBe(200)
    expect((await change('owner', 'http-replay')).status).toBe(200)
    const url = '/api/audit?entity=Item&recordId=item'
    const response = await engine().fetch(request(url, 'owner'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const history = (await response.json()) as any[]
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ actorId: 'owner', actionName: 'Change' })
    expect((await engine().fetch(request(url))).status).toBe(401)
    expect((await engine().fetch(request(url, 'other'))).status).toBe(404)
    expect((await engine().fetch(request(url, 'limited'))).status).toBe(403)
    expect((await engine().fetch(request('/api/audit?entity=Item', 'owner'))).status).toBe(400)
    expect((await engine().fetch(request(`${url}&limit=1000`, 'owner'))).status).toBe(400)
    expect(await (await engine().fetch(request(`${url}&command=Other`, 'owner'))).json()).toEqual([])
  })

  it('omits unreadable mutation fields from authorized history', async () => {
    await queries.update('Item', 'item', { value: 'visible', private: 'hidden-value' }, { session: SYSTEM_SESSION })
    const response = await engine().fetch(request('/api/audit?entity=Item&recordId=item', 'owner'))
    const history = (await response.json()) as any[]
    expect(history[0].metadata.mutation).toEqual({ value: 'visible' })
    expect(JSON.stringify(history)).not.toContain('hidden-value')
  })

  it('keeps events private to each API credential even when their agent IDs match', async () => {
    expect((await change('agent')).status).toBe(200)
    expect(await journal.queryEvents('credential:agent-one', 0)).toHaveLength(1)
    expect(await journal.queryEvents('credential:agent-two', 0)).toEqual([])
    expect(await journal.queryEvents('actor:user:agent-one', 0)).toEqual([])
    expect(await journal.queryEvents('actor:user:owner', 0)).toEqual([])
  })

  it('commits only one journal batch when identical requests race across isolates', async () => {
    const responses = await Promise.all([change('owner', 'raced'), change('owner', 'raced')])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(await responses[0]!.json()).toEqual(await responses[1]!.json())
    expect(await journal.queryAudit({ entity: 'Item', recordId: 'item' })).toHaveLength(1)
    expect(await journal.queryEvents('actor:user:owner', 0)).toHaveLength(1)
  })

  it('streams events from another isolate and replays using Last-Event-ID', async () => {
    const stream = await engine().fetch(request('/api/agent/events', 'owner'))
    expect(stream.headers.get('content-type')).toBe('text/event-stream')
    const reader = stream.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain(': connected')
    expect((await change()).status).toBe(200)
    const event = decoder.decode((await reader.read()).value)
    expect(event).toContain('event: domain.Change')
    const id = /^id: (\d+)$/m.exec(event)![1]!
    await reader.cancel()
    expect((await change()).status).toBe(200)
    const resumed = await engine().fetch(request('/api/agent/events', 'owner', { headers: { 'last-event-id': id } }))
    const resumedReader = resumed.body!.getReader()
    await resumedReader.read()
    const replay = decoder.decode((await resumedReader.read()).value)
    expect(replay).toContain('event: domain.Change')
    expect(Number(/^id: (\d+)$/m.exec(replay)![1])).toBeGreaterThan(Number(id))
    await resumedReader.cancel()
  })

  it('requires authentication and validates event cursors', async () => {
    expect((await engine().fetch(request('/api/agent/events'))).status).toBe(401)
    expect(
      (await engine().fetch(request('/api/agent/events', 'owner', { headers: { 'last-event-id': 'oops' } }))).status
    ).toBe(400)
  })

  it('rechecks record authorization before delivering replayed events', async () => {
    await change()
    await db.query("UPDATE Item SET ownerId = 'other' WHERE id = 'item'")
    const controller = new AbortController()
    const response = await engine().fetch(
      request('/api/agent/events', 'owner', { headers: { 'last-event-id': '0' }, signal: controller.signal })
    )
    const reader = response.body!.getReader()
    await reader.read()
    const next = reader.read()
    // Give the replay scan time to run; an unauthorized event must never be emitted.
    await new Promise((resolve) => setTimeout(resolve, 50))
    controller.abort()
    expect(await next).toEqual({ value: undefined, done: true })
  })

  it('commits transactional workflow completion with its mutations and records guarded query updates', async () => {
    const workflow = {
      name: 'Atomic',
      trigger: { manual: true },
      transactional: true,
      retries: 1,
      steps: [
        {
          type: 'query',
          entity: 'Item',
          action: 'update',
          where: { id: 'item', value: 'old' },
          data: { value: 'workflow' }
        },
        { type: 'command', command: 'Change', recordId: 'item', input: { value: 'command' } }
      ]
    }
    const workflows = new D1WorkflowExecutor({ ...blueprint, workflows: [workflow] } as any, db, queries, {
      auditLifecycle: true,
      commandExecutor: commands
    })
    const job = await workflows.triggerManual('Atomic', {}, owner)
    expect(job.status).toBe('completed')
    const history = await journal.queryAudit({ entity: 'Item', recordId: 'item', workflow: 'Atomic' })
    expect(history.map((entry) => entry.eventType)).toEqual(['domain.command', 'data.update'])
    const audit = (await db.query<{ entry_json: string }>('SELECT entry_json FROM _zebric_audit')).rows.map((row) =>
      JSON.parse(row.entry_json)
    )
    expect(audit.filter((entry) => entry.eventType === 'workflow.completed')).toMatchObject([
      { auditId: `workflow:${job.id}:completed`, success: true }
    ])
  })

  it('retains a failed workflow outcome while rolling back its mutation history', async () => {
    const workflow = {
      name: 'Rollback',
      trigger: { manual: true },
      transactional: true,
      retries: 1,
      steps: [
        { type: 'query', entity: 'Item', action: 'update', where: { id: 'item' }, data: { value: 'rolled back' } },
        { type: 'query', entity: 'Item', action: 'update', where: { id: 'missing' }, data: { value: 'fail' } }
      ]
    }
    const workflows = new D1WorkflowExecutor({ ...blueprint, workflows: [workflow] } as any, db, queries, {
      auditLifecycle: true
    })
    const job = await workflows.triggerManual('Rollback', {}, SYSTEM_SESSION)
    expect(job.status).toBe('failed')
    expect((await db.query('SELECT value FROM Item')).rows[0]).toEqual({ value: 'old' })
    expect(await journal.queryAudit({ entity: 'Item', recordId: 'item' })).toEqual([])
    const audit = (await db.query<{ entry_json: string }>('SELECT entry_json FROM _zebric_audit')).rows.map((row) =>
      JSON.parse(row.entry_json)
    )
    expect(audit).toMatchObject([
      { eventType: 'workflow.failed', success: false, auditId: `workflow:${job.id}:failed` }
    ])
  })

  it('keeps workflow audit and domain events unique when a native transaction checkpoint is lost', async () => {
    const workflow = {
      name: 'Checkpoint',
      trigger: { manual: true },
      transactional: true,
      retries: 1,
      steps: [{ type: 'command', command: 'Change', recordId: 'item', input: { value: 'checkpoint' } }]
    }
    const workflows = new D1WorkflowExecutor({ ...blueprint, workflows: [workflow] } as any, db, queries, {
      auditLifecycle: true,
      commandExecutor: commands
    })
    const payload = {
      job: {
        id: 'lost-checkpoint',
        status: 'pending',
        workflowName: workflow.name,
        createdAt: new Date().toISOString()
      },
      workflow,
      context: {
        trigger: { type: 'manual' },
        session: owner,
        variables: { __zebric: { currentWorkflow: workflow.name, workflowPath: [workflow.name] } }
      }
    }
    const step = {
      do: async (_name: string, _config: unknown, operation: () => Promise<unknown>) => operation()
    } as any
    const first = await workflows.runDurable(structuredClone(payload) as any, step)
    expect(await workflows.runDurable(structuredClone(payload) as any, step)).toEqual(first)
    expect(await journal.queryEvents('actor:user:owner', 0)).toHaveLength(1)
    const history = (await db.query<{ entry_json: string }>('SELECT entry_json FROM _zebric_audit')).rows.map((row) =>
      JSON.parse(row.entry_json)
    )
    expect(history.map((entry) => entry.eventType)).toEqual(['domain.command', 'workflow.completed'])
  })
})
