import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CommandExecutor, QueryExecutorPort, UserSession } from '../../packages/runtime-core/src/index.js'

import { session } from './fixtures.js'
export { blueprint, session } from './fixtures.js'

export interface ConformanceRuntime {
  queries: QueryExecutorPort
  commands: Pick<CommandExecutor, 'execute'>
  fetch(path: string, init?: RequestInit): Promise<Response>
  runWorkflow(name: string): Promise<string>
  setSession(value: UserSession | null): void
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

    const livePoll = async (cursor: string, path = '/live-items') => {
      const response = await runtime.fetch('/_zebric/live?' + new URLSearchParams({ path, cursor, transport: 'poll' }))
      expect(response.status).toBe(200)
      return response.json()
    }
    const renderCursor = async () => {
      const response = await runtime.fetch('/live-items')
      expect(response.status).toBe(200)
      const html = await response.text()
      const cursor = /data-zebric-live-cursor="(\d+)"/.exec(html)?.[1]
      expect(cursor).toBeDefined()
      return cursor!
    }

    it('renders live metadata only on opted-in pages', async () => {
      expect(await renderCursor()).toBe('0')
      expect(await (await runtime.fetch('/items')).text()).not.toContain('data-zebric-live-cursor')
      expect((await runtime.fetch('/_zebric/live?path=/items')).status).toBe(404)
      expect((await runtime.fetch('/_zebric/live?path=//external.example')).status).toBe(400)
      expect((await runtime.fetch('/_zebric/live?path=/live-items&cursor=invalid')).status).toBe(400)
    })

    it('reconciles the render-to-subscribe race and duplicate reconnects', async () => {
      const cursor = await renderCursor()
      await seed('raced')
      const event = await livePoll(cursor)
      expect(event).toEqual({ type: 'invalidate', cursor: expect.any(String) })
      expect(await livePoll(cursor)).toEqual(event)
      expect(await livePoll(event.cursor)).toEqual({ type: 'current', cursor: event.cursor })
      expect(await (await runtime.fetch('/live-items')).text()).toContain('raced')
    })

    it.each(['UI', 'HTTP', 'MCP', 'command', 'workflow'])('%s mutations invalidate the same live page', async source => {
      await seed('source')
      const cursor = await renderCursor()
      if (source === 'UI') {
        expect((await runtime.fetch('/new-item', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{"title":"UI change"}' })).status).toBe(200)
      } else if (source === 'MCP') {
        const { mutateThroughMcp } = await import('../../packages/mcp-server/tests/live-mutation-helper.js')
        await mutateThroughMcp(runtime.fetch)
      } else if (source === 'HTTP') {
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        expect((await runtime.fetch('/api/items/source', { method: 'PUT', headers, body: JSON.stringify({ title: source + ' change' }) })).status).toBe(200)
      } else if (source === 'command') {
        await runtime.commands.execute({ command: 'PublishItem', recordId: 'source', context })
      } else expect(await runtime.runWorkflow('CopyItems')).toBe('completed')
      expect(await livePoll(cursor)).toMatchObject({ type: 'invalidate' })
    })

    it.each(['UpdateItem', 'DeleteItem'])('guarded %s workflow changes invalidate live views', async name => {
      await seed('source')
      const cursor = await renderCursor()
      expect(await runtime.runWorkflow(name)).toBe('completed')
      expect(await livePoll(cursor)).toMatchObject({ type: 'invalidate' })
    })

    it('exposes stable, ordered committed change events independently of audit records', async () => {
      await seed('event')
      await runtime.queries.update('Item', 'event', { title: 'updated' }, context)
      const events = await runtime.queries.liveChanges!.changesAfter('0')
      expect(events.map(event => event.operation)).toEqual(['create', 'update'])
      expect(events.map(event => event.entity)).toEqual(['Item', 'Item'])
      expect(new Set(events.map(event => event.id)).size).toBe(2)
      expect(Number(events[1].cursor)).toBeGreaterThan(Number(events[0].cursor))
      expect(await runtime.queries.liveChanges!.changesAfter('0')).toEqual(events)
      expect(events[0]).not.toHaveProperty('metadata')
    })

    it('does not publish rolled-back command or workflow mutations', async () => {
      const cursor = await renderCursor()
      await expect(runtime.queries.transaction!(async () => { await seed('abort'); throw new Error('abort') })).rejects.toThrow('abort')
      expect(await runtime.runWorkflow('RollbackWorkflow')).toBe('failed')
      expect(await livePoll(cursor)).toEqual({ type: 'current', cursor })
    })

    it('does not advance the journal for rejected HTTP writes or command replay', async () => {
      await seed('source')
      const cursor = await renderCursor()
      const headers = { 'content-type': 'application/json' }
      const protectedWrite = await runtime.fetch('/api/items/source', { method: 'PUT', headers, body: '{"status":"published"}' })
      expect(protectedWrite.ok).toBe(false)
      expect(await runtime.queries.findById('Item', 'source', context)).toMatchObject({ status: 'draft', published: false })
      expect((await runtime.fetch('/api/items', { method: 'POST', headers, body: '{invalid' })).status).toBe(400)
      expect(await livePoll(cursor)).toEqual({ type: 'current', cursor })
      const publish = () => runtime.fetch('/api/commands/publish_item/source', {
        method: 'POST', headers: { ...headers, 'idempotency-key': 'live-replay' }, body: '{}',
      })
      const first = await publish()
      expect(first.status).toBe(200)
      const committed = await runtime.queries.liveChanges!.currentCursor()
      expect(await livePoll(cursor)).toEqual({ type: 'invalidate', cursor: committed })
      expect(await (await publish()).json()).toEqual(await first.json())
      expect(await livePoll(committed)).toEqual({ type: 'current', cursor: committed })
    })

    it('keeps successful journal pagination stable across creates, updates, and deletes', async () => {
      const source = runtime.queries.liveChanges!
      const cursor = await source.currentCursor()
      await seed('paged')
      await runtime.queries.update('Item', 'paged', { title: 'changed' }, context)
      await runtime.queries.delete('Item', 'paged', context)
      const all = await source.changesAfter(cursor)
      expect(all.map(event => [event.operation, event.recordId])).toEqual([
        ['create', 'paged'], ['update', 'paged'], ['delete', 'paged'],
      ])
      const first = await source.changesAfter(cursor, 1)
      const rest = await source.changesAfter(first[0].cursor, 2)
      expect([...first, ...rest]).toEqual(all)
      expect(await source.changesAfter(rest[1].cursor)).toEqual([])
      for (const event of all) {
        expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false)
        expect(Object.keys(event).sort()).toEqual(['cursor', 'entity', 'id', 'operation', 'recordId', 'timestamp'])
      }
      expect(await livePoll(cursor)).toEqual({ type: 'invalidate', cursor: all[2].cursor })
    })

    it('commits nested mutations together and removes all nested events on rollback', async () => {
      const source = runtime.queries.liveChanges!
      const cursor = await source.currentCursor()
      await runtime.queries.transaction!(async () => {
        await seed('nested')
        await runtime.queries.transaction!(async () => {
          await runtime.queries.update('Item', 'nested', { title: 'committed nested' }, context)
        })
      })
      const committed = await source.currentCursor()
      expect((await source.changesAfter(cursor)).map(event => event.operation)).toEqual(['create', 'update'])
      await expect(runtime.queries.transaction!(async () => {
        await runtime.queries.transaction!(async () => { await runtime.queries.delete('Item', 'nested', context) })
        throw new Error('outer rollback')
      })).rejects.toThrow('outer rollback')
      expect(await runtime.queries.findById('Item', 'nested', context)).toMatchObject({ title: 'committed nested' })
      expect(await source.changesAfter(committed)).toEqual([])
      expect(await livePoll(committed)).toEqual({ type: 'current', cursor: committed })
    })

    it('advances past unrelated changes without losing the next relevant invalidation', async () => {
      const cursor = await renderCursor()
      await runtime.queries.create('Other', { id: 'unrelated' }, context)
      const skipped = await runtime.queries.liveChanges!.currentCursor()
      expect(await livePoll(cursor)).toEqual({ type: 'current', cursor: skipped })
      await seed('relevant')
      const current = await runtime.queries.liveChanges!.currentCursor()
      expect(await livePoll(skipped)).toEqual({ type: 'invalidate', cursor: current })
      expect(await livePoll(current)).toEqual({ type: 'current', cursor: current })
    })

    it('filters dependencies and reconciles durable cursors after disconnect', async () => {
      const source = runtime.queries.liveChanges!
      const cursor = await source.currentCursor()
      await runtime.queries.create('Other', { id: 'other' }, context)
      expect(await livePoll(cursor)).toMatchObject({ type: 'current' })
      await seed('offline')
      expect(await source.reconcile([{ entity: 'Other' }], await source.currentCursor())).toMatchObject({ changed: false })
      expect(await source.reconcile([{ entity: 'Item' }], cursor)).toMatchObject({ changed: true })
      expect(await source.reconcile([{ entity: 'Item' }], '999999999')).toMatchObject({ changed: true })
    })

    it('rejects anonymous and expired subscriptions and reauthorizes fresh projections', async () => {
      await seed('private')
      await seed('public', { published: true })
      expect((await runtime.fetch('/_zebric/live?path=/live-secret&transport=poll')).status).toBe(403)
      expect((await runtime.fetch('/live-secret')).status).not.toBe(200)
      runtime.setSession(null)
      expect((await runtime.fetch('/_zebric/live?path=/live-items&transport=poll')).status).toBe(401)
      const publicResponse = await runtime.fetch('/live-public', { headers: { accept: 'application/json' } })
      expect(publicResponse.status).toBe(200)
      expect((await publicResponse.json()).data.items.map((row: { id: string }) => row.id)).toEqual(['public'])
      runtime.setSession({ ...session, expiresAt: new Date(0) })
      expect((await runtime.fetch('/_zebric/live?path=/live-items&transport=poll')).status).toBe(401)
    })

    it('SSE catches up from the render cursor without exposing audit or record data', async () => {
      const cursor = await renderCursor()
      await seed('sse-secret', { title: 'sensitive record title' })
      const abort = new AbortController()
      const response = await runtime.fetch('/_zebric/live?' + new URLSearchParams({ path: '/live-items', cursor }), { signal: abort.signal, headers: { 'last-event-id': cursor } })
      expect(response.headers.get('content-type')).toBe('text/event-stream')
      const reader = response.body!.getReader()
      let data = ''
      while (!data.includes('event: invalidate')) {
        const chunk = await reader.read()
        expect(chunk.done).toBe(false)
        data += new TextDecoder().decode(chunk.value)
      }
      expect(data).toMatch(/data: \{"type":"invalidate","cursor":"\d+"\}/)
      expect(data).not.toContain('sensitive record title')
      expect(data).not.toContain('Item')
      abort.abort()
      await reader.cancel()
    })

    it('reauthorizes open SSE connections and closes safely when page authentication is revoked', async () => {
      const cursor = await renderCursor()
      const response = await runtime.fetch('/_zebric/live?' + new URLSearchParams({ path: '/live-items', cursor }))
      const reader = response.body!.getReader()
      await reader.read()
      runtime.setSession(null)
      let data = ''
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        data += new TextDecoder().decode(chunk.value)
      }
      expect(data).toContain('event: unavailable')
      expect(data).not.toContain('event: invalidate')
      await reader.cancel()
    })

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
