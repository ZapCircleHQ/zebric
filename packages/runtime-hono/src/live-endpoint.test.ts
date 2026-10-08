import { describe, expect, it, vi } from 'vitest'
import type { Blueprint, LiveChangeSource, QueryExecutorPort, UserSession } from '@zebric/runtime-core'
import { handleLive } from './live-endpoint.js'

const blueprint: Blueprint = {
  version: '1.0', project: { name: 'Live', version: '1.0', runtime: { min_version: '0.1' } },
  entities: [], pages: [{ path: '/live', title: 'Live', live: true, auth: 'none', queries: { items: { entity: 'Item' } } }],
}
function setup() {
  const source: LiveChangeSource = { currentCursor: vi.fn(async () => '0'), changesAfter: vi.fn(async () => []), reconcile: vi.fn(async () => ({ cursor: '0', changed: false })) }
  const queries = { execute: vi.fn(async () => []), liveChanges: source } as unknown as QueryExecutorPort
  const request = (transport = 'poll') => new Request(`https://test.example/_zebric/live?path=/live&cursor=0&transport=${transport}`)
  return { source, queries, request }
}

describe('Live transport failure handling', () => {
  it('rejects read permission failures and allows retrying temporary query failures', async () => {
    const { queries, request } = setup()
    vi.mocked(queries.execute).mockRejectedValueOnce(new Error('Access denied: Cannot read Item'))
    expect((await handleLive(request(), blueprint, { queryExecutor: queries })).status).toBe(403)
    vi.mocked(queries.execute).mockRejectedValueOnce(new Error('Database temporarily offline'))
    expect((await handleLive(request(), blueprint, { queryExecutor: queries })).status).toBe(503)
  })

  it('returns a retryable polling error when durable reconciliation is unavailable', async () => {
    const { source, queries, request } = setup()
    vi.mocked(source.reconcile).mockRejectedValueOnce(new Error('Database temporarily offline'))
    const response = await handleLive(request(), blueprint, { queryExecutor: queries })
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('Database')
  })

  it('interrupts SSE on temporary storage failure so the client can fall back and reconnect', async () => {
    const { source, queries, request } = setup()
    vi.mocked(source.reconcile).mockRejectedValueOnce(new Error('Database temporarily offline'))
    const response = await handleLive(request('sse'), blueprint, { queryExecutor: queries })
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(': connected\n\n')
    await expect(reader.read()).rejects.toThrow('Live connection interrupted')
  })
})

describe('Live endpoint protocol and authorization', () => {
  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'])('rejects %s without querying storage', async method => {
    const { queries, source, request } = setup()
    const response = await handleLive(new Request(request(), { method }), blueprint, { queryExecutor: queries })
    expect(response.status).toBe(405)
    expect(queries.execute).not.toHaveBeenCalled()
    expect(source.reconcile).not.toHaveBeenCalled()
  })

  it.each(['', 'https://evil.test/live', '//evil.test/live', '/live#fragment'])('rejects unsafe path %j', async path => {
    const { queries } = setup()
    const response = await handleLive(new Request('https://test.example/_zebric/live?' + new URLSearchParams({ path })), blueprint, { queryExecutor: queries })
    expect(response.status).toBe(400)
    expect(queries.execute).not.toHaveBeenCalled()
  })

  it.each(['-1', '1.5', 'NaN', '9007199254740992', ''])('rejects cursor %j before reconciliation', async cursor => {
    const { queries, source } = setup()
    const request = new Request('https://test.example/_zebric/live?' + new URLSearchParams({ path: '/live', cursor, transport: 'poll' }))
    expect((await handleLive(request, blueprint, { queryExecutor: queries })).status).toBe(400)
    expect(source.reconcile).not.toHaveBeenCalled()
  })

  it('uses Last-Event-ID ahead of the render cursor and returns only minimal metadata', async () => {
    const { queries, source, request } = setup()
    vi.mocked(source.reconcile).mockResolvedValue({ cursor: '8', changed: true })
    const response = await handleLive(new Request(request(), { headers: { 'last-event-id': '7' } }), blueprint, { queryExecutor: queries })
    expect(source.reconcile).toHaveBeenCalledWith([{ entity: 'Item' }], '7')
    expect(await response.json()).toEqual({ type: 'invalidate', cursor: '8' })
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization')
  })

  it('authorizes filtered page queries with route parameters and every discovered dependency', async () => {
    const { queries, request } = setup()
    const view: Blueprint = { ...blueprint, pages: [{ ...blueprint.pages[0], path: '/live/:id',
      queries: { items: { entity: 'Item', where: { id: '$params.id' } } },
      widget: { kind: 'board', entity: 'Item', column_entity: 'Status' },
      form: { entity: 'Item', method: 'update', fields: [{ name: 'owner', type: 'lookup', lookup: { entity: 'User', search: ['name'] } }] },
    }] }
    const response = await handleLive(new Request(request().url.replace('path=/live', 'path=/live/selected%3Ffilter%3Dopen')), view, { queryExecutor: queries })
    expect(response.status).toBe(200)
    expect(queries.execute).toHaveBeenCalledWith(view.pages[0].queries!.items, expect.objectContaining({ params: { id: 'selected' }, query: { filter: 'open' } }))
    for (const entity of ['Item', 'Status', 'User']) expect(queries.execute).toHaveBeenCalledWith({ entity, limit: 1 }, { session: null })
  })

  it.each(['identity', 'permissions'])('rechecks %s before sending an SSE invalidation', async failure => {
    const { queries, source, request } = setup()
    const original = { user: { id: 'first', email: 'first@test.example', roles: [] } } as unknown as UserSession
    let current = original
    const getSession = vi.fn(async () => current)
    vi.mocked(source.reconcile).mockImplementation(async () => {
      if (failure === 'identity') current = { ...original, user: { ...original.user, id: 'second' } }
      else vi.mocked(queries.execute).mockRejectedValue(new Error('Access denied: Cannot read Item'))
      return { cursor: '1', changed: true }
    })
    const response = await handleLive(request('sse'), blueprint, { queryExecutor: queries, sessionManager: { getSession } as any })
    const reader = response.body!.getReader()
    try {
      let data = ''
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        data += new TextDecoder().decode(chunk.value)
      }
      expect(data).toContain('event: unavailable')
      expect(data).not.toContain('event: invalidate')
      expect(getSession).toHaveBeenCalledTimes(2)
    } finally { await reader.cancel() }
  })

  it('cancels an SSE stream without another reconciliation', async () => {
    vi.useFakeTimers()
    const { queries, source, request } = setup()
    try {
      const response = await handleLive(request('sse'), blueprint, { queryExecutor: queries })
      const reader = response.body!.getReader()
      await reader.read()
      await reader.cancel()
      const calls = vi.mocked(source.reconcile).mock.calls.length
      await vi.advanceTimersByTimeAsync(3000)
      expect(await reader.read()).toEqual({ done: true, value: undefined })
      expect(source.reconcile).toHaveBeenCalledTimes(calls)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
