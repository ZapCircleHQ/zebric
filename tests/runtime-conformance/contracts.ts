import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CommandExecutor, Blueprint, QueryExecutorPort, UserSession } from '../../packages/runtime-core/src/index.js'

export const session = { user: { id: 'operator', email: 'operator@example.test', roles: ['operator'] } } as UserSession
export const blueprint: Blueprint = {
  version: '0.6.0',
  project: { name: 'Runtime conformance', version: '1.0.0', runtime: { min_version: '0.6.0' } },
  auth: { providers: [], apiKeys: [
    { name: 'writer', keyEnv: 'WRITER_KEY', roles: ['operator'], scopes: ['*'] },
    { name: 'reader', keyEnv: 'READER_KEY', roles: ['operator'], scopes: ['entity.item.list', 'entity.item.get'] },
  ] },
  entities: [{
    name: 'Item',
    fields: [
      { name: 'id', type: 'ULID', primary_key: true },
      { name: 'title', type: 'Text' },
      { name: 'published', type: 'Boolean', default: false },
      { name: 'priority', type: 'Integer', default: 0 },
      { name: 'status', type: 'Text', default: 'draft', write: 'command-only', commands: ['PublishItem'] },
      { name: 'payload', type: 'JSON' },
      { name: 'scheduledAt', type: 'DateTime' },
      { name: 'createdAt', type: 'DateTime', default: 'now' },
      { name: 'updatedAt', type: 'DateTime' },
    ],
    access: { read: { or: [{ published: true }, 'authenticated'] }, create: 'authenticated', update: 'authenticated', delete: 'authenticated' },
  }],
  pages: [{ path: '/items', title: 'Items', layout: 'list', auth: 'optional', queries: { items: { entity: 'Item' } } }],
  workflows: [
    { name: 'CopyItems', trigger: { manual: true }, transactional: true, retries: 1, steps: [
      { type: 'query', action: 'find', entity: 'Item', assignTo: 'items' },
      { type: 'loop', items: 'variables.items', do: [
        { type: 'condition', if: { 'variables.item.published': false }, then: [
          { type: 'query', action: 'create', entity: 'Item', data: {
            id: 'copy-{{variables.item.id}}', title: '{{variables.item.title}}',
            priority: '{{variables.item.priority}}', payload: '{{variables.item.payload}}',
          } },
        ] },
      ] },
    ] },
    { name: 'RollbackWorkflow', trigger: { manual: true }, transactional: true, retries: 1, steps: [
      { type: 'query', action: 'create', entity: 'Item', data: { id: 'workflow-rollback' } },
      { type: 'query', action: 'create', entity: 'Item', data: { id: 'workflow-rollback' } },
    ] },
  ],
  commands: [{ name: 'PublishItem', entity: 'Item', availableWhen: { status: 'draft' }, mutations: { status: 'published', published: true } }],
}

export interface ConformanceRuntime {
  queries: QueryExecutorPort
  commands: Pick<CommandExecutor, 'execute'>
  fetch(path: string, init?: RequestInit): Promise<Response>
  runWorkflow(name: string): Promise<string>
  cleanup(): Promise<void>
}

/** One set of expected behaviors, run unchanged against SQLite and real Miniflare D1. */
export function runtimeConformance(name: string, create: () => Promise<ConformanceRuntime>): void {
  describe(`${name} runtime conformance`, () => {
    let runtime: ConformanceRuntime
    const context = { session }
    beforeEach(async () => { runtime = await create() })
    afterEach(async () => { await runtime?.cleanup() })
    const seed = (id: string, data: Record<string, unknown> = {}) => runtime.queries.create('Item', { id, title: id, ...data }, context)
    const wire = (value: unknown) => JSON.parse(JSON.stringify(value))

    it('generates IDs and preserves falsy Blueprint defaults without mutating input', async () => {
      const input = { title: 'New item' }
      const record = await runtime.queries.create('Item', input, context)
      expect(record.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(record).toMatchObject({ published: false, priority: 0, status: 'draft' })
      expect(Number.isNaN(Date.parse(wire(record).createdAt))).toBe(false)
      expect(input).toEqual({ title: 'New item' })
    })

    it('round-trips structured JSON and explicit nulls', async () => {
      const payload = { nested: [false, 0, { value: 'ok' }] }
      await seed('json', { payload, scheduledAt: null })
      expect(wire(await runtime.queries.findById('Item', 'json', context))).toMatchObject({ payload, scheduledAt: null })
    })

    it.each(['a JSON string', '', false, true, 0, [false, 0]])('round-trips JSON primitive values %j', async payload => {
      await seed('primitive', { payload })
      expect(wire(await runtime.queries.findById('Item', 'primitive', context)).payload).toEqual(payload)
    })

    it('normalizes datetime-local values as UTC and blank optional dates as null', async () => {
      await seed('date', { scheduledAt: '2026-06-22T14:30' })
      expect(wire(await runtime.queries.findById('Item', 'date', context)).scheduledAt).toBe('2026-06-22T14:30:00.000Z')
      await runtime.queries.update('Item', 'date', { scheduledAt: '' }, context)
      expect(wire(await runtime.queries.findById('Item', 'date', context)).scheduledAt).toBeNull()
    })

    it('rejects invalid dates before writing', async () => {
      await expect(seed('bad-date', { scheduledAt: 'invalid' })).rejects.toThrow('Invalid DateTime')
      expect(await runtime.queries.findById('Item', 'bad-date', context)).toBeNull()
    })

    it('filters private rows before pagination and lookup search', async () => {
      await seed('a-private')
      await seed('b-public', { published: true })
      const rows = await runtime.queries.execute({ entity: 'Item', orderBy: { title: 'asc' }, limit: 1 }, { session: null })
      expect(rows.map((row: { id: string }) => row.id)).toEqual(['b-public'])
      const search = await runtime.queries.search('Item', ['title'], 'public', { context: { session: null }, limit: 1 })
      expect(search.map(row => row.id)).toEqual(['b-public'])
      expect(await runtime.queries.findById('Item', 'a-private', { session: null })).toBeNull()
    })

    it('resolves canonical placeholders and fails closed on missing parameters', async () => {
      await seed('selected')
      const rows = await runtime.queries.execute({ entity: 'Item', where: { id: '$params.id' } }, { ...context, params: { id: 'selected' } })
      expect(rows.map((row: { id: string }) => row.id)).toEqual(['selected'])
      expect(await runtime.queries.execute({ entity: 'Item', where: { id: '$params.missing' } }, context)).toEqual([])
    })

    it('rejects anonymous mutations and direct writes to command-only fields', async () => {
      await seed('protected')
      await expect(runtime.queries.update('Item', 'protected', { title: 'Denied' }, { session: null })).rejects.toThrow('Access denied')
      await expect(runtime.queries.update('Item', 'protected', { status: 'published' }, context)).rejects.toThrow()
      expect(await runtime.queries.findById('Item', 'protected', context)).toMatchObject({ title: 'protected', status: 'draft' })
    })

    it('reads staged writes, joins nested transactions, and suppresses effects on rollback', async () => {
      const effects: string[] = []
      await expect(runtime.queries.transaction!(async () => {
        await seed('rolled-back')
        await runtime.queries.transaction!(async () => {
          await runtime.queries.update('Item', 'rolled-back', { title: 'Staged' }, context)
          expect(await runtime.queries.findById('Item', 'rolled-back', context)).toMatchObject({ title: 'Staged' })
          await runtime.queries.afterCommit!(() => { effects.push('committed') })
        })
        throw new Error('abort')
      })).rejects.toThrow('abort')
      expect(await runtime.queries.findById('Item', 'rolled-back', context)).toBeNull()
      expect(effects).toEqual([])
    })

    it('runs commit effects only after successful mutations', async () => {
      const effects: string[] = []
      await runtime.queries.transaction!(async () => {
        await seed('committed')
        await runtime.queries.afterCommit!(() => { effects.push('committed') })
        expect(effects).toEqual([])
      })
      expect(effects).toEqual(['committed'])
      expect(await runtime.queries.findById('Item', 'committed', context)).toMatchObject({ id: 'committed' })
    })

    it('executes protected command mutations and enforces availability', async () => {
      await seed('command')
      const commands = runtime.commands
      const result = await commands.execute({ command: 'PublishItem', recordId: 'command', context })
      expect(result.record).toMatchObject({ status: 'published', published: true })
      await expect(commands.execute({ command: 'PublishItem', recordId: 'command', context })).rejects.toThrow()
    })

    it('uses typed intermediate query results inside transactional workflow loops and conditions', async () => {
      await seed('workflow-source', { priority: 7, payload: { nested: [false, 0] } })
      await seed('workflow-public', { published: true })
      expect(await runtime.runWorkflow('CopyItems')).toBe('completed')
      expect(wire(await runtime.queries.findById('Item', 'copy-workflow-source', context)))
        .toMatchObject({ priority: 7, payload: { nested: [false, 0] }, published: false })
      expect(await runtime.queries.findById('Item', 'copy-workflow-public', context)).toBeNull()
    })

    it('rolls back all writes when a transactional workflow fails', async () => {
      expect(await runtime.runWorkflow('RollbackWorkflow')).toBe('failed')
      expect(await runtime.queries.findById('Item', 'workflow-rollback', context)).toBeNull()
    })

    it('renders pages through the shared HTTP adapter', async () => {
      await seed('visible', { published: true })
      const response = await runtime.fetch('/items', { headers: { accept: 'application/json' } })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ page: '/items', data: { items: [expect.objectContaining({ id: 'visible', published: true })] } })
    })

    it('publishes supported commands and matching discovery fingerprints', async () => {
      const discovery = await (await runtime.fetch('/.well-known/zebric-agent.json')).json()
      expect(discovery.commands).toEqual([expect.objectContaining({ name: 'PublishItem', operationId: 'publish_item' })])
      const response = await runtime.fetch('/api/openapi.json')
      expect((await response.json())['x-zebric-contract']).toEqual(discovery.contract)
      expect(response.headers.get('etag')).toBe(`"${discovery.contract.fingerprint}"`)
    })

    it('enforces agent scopes and run attribution', async () => {
      const headers = { 'content-type': 'application/json', authorization: 'Bearer reader-key', 'x-agent-run-id': 'conformance-run' }
      expect((await runtime.fetch('/api/items', { headers })).status).toBe(200)
      expect((await runtime.fetch('/api/items', { method: 'POST', headers, body: '{"title":"Denied"}' })).status).toBe(403)
      expect((await runtime.fetch('/api/items', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer writer-key' }, body: '{"title":"No run"}' })).status).toBe(400)
      const created = await runtime.fetch('/api/items', { method: 'POST', headers: { ...headers, authorization: 'Bearer writer-key' }, body: '{"title":"Attributed"}' })
      expect(created.status).toBe(201)
    })

    it('rejects invalid browser CSRF even when an invalid bearer token is present', async () => {
      const response = await runtime.fetch('/api/items', { method: 'POST', headers: {
        'content-type': 'application/json', cookie: 'csrf-token=expected', 'x-csrf-token': 'wrong', authorization: 'Bearer invalid',
      }, body: '{"title":"Denied"}' })
      expect(response.status).toBe(403)
    })

    it.each(['[]', 'null', '{invalid'])('rejects malformed entity input %s before writing', async body => {
      const response = await runtime.fetch('/api/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      expect(response.status).toBe(400)
      expect(await runtime.queries.execute({ entity: 'Item' }, context)).toEqual([])
    })

    it('exposes CRUD with consistent JSON values', async () => {
      const response = await runtime.fetch('/api/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'HTTP' }) })
      expect(response.status).toBe(201)
      const created = await response.json()
      const read = await runtime.fetch(`/api/items/${created.id}`)
      expect(await read.json()).toMatchObject({ title: 'HTTP', published: false, priority: 0 })
      const deleted = await runtime.fetch(`/api/items/${created.id}`, { method: 'DELETE' })
      expect(deleted.status).toBe(200)
      expect((await runtime.fetch(`/api/items/${created.id}`)).status).toBe(404)
    })

    it('replays committed command HTTP responses and rejects changed input', async () => {
      await seed('receipt')
      const request = (body: string) => runtime.fetch('/api/commands/publish_item/receipt', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'same-key' }, body })
      const first = await request('{}')
      expect(first.status).toBe(200)
      expect(await (await request('{}')).json()).toEqual(await first.json())
      const changed = await request('{"changed":true}')
      expect(changed.status).toBe(409)
      expect(await changed.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSE' } })
    })
  })
}
