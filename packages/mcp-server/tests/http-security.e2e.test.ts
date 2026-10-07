import { request as nodeRequest } from 'node:http'
import type { Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createZebricMcpHttpHandler, type ZebricMcpHttpOptions } from '../src/http.js'
import { createZebricMcpNodeHandler, startZebricMcpHttpServer } from '../src/node.js'

const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }
const list = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
const read = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'zebric_items_list', arguments: {} } })
const write = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'zebric_items_create', arguments: {} } })
const authorize = (request: Request) => request.headers.get('authorization') === 'Bearer client-secret'

function application() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/.well-known/zebric-agent.json')) return Response.json({ name: 'App', openapi: '/openapi.json' })
    if (url.endsWith('/openapi.json')) return Response.json({
      openapi: '3.1.0', info: { title: 'App', version: '1' }, paths: {
        '/items': {
          get: { operationId: 'items_list' },
          post: { operationId: 'items_create', 'x-zebric-agent-operation': {
            risk: 'write', approvalRequired: true, idempotencyRequired: true, asynchronous: false, requiredScopes: [],
          } },
        },
      },
    })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer upstream-secret')
    return Response.json([{ id: 'private-item' }])
  })
}

const servers: Server[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) {
    server.close()
    server.closeAllConnections()
    await once(server, 'close')
  }
})

describe('HTTP authentication configuration', () => {
  it('requires an explicit authentication policy for mounted handlers and public listeners', async () => {
    const options = { applicationUrl: 'https://app.example', credential: () => 'upstream-secret' }
    expect(() => createZebricMcpHttpHandler(options)).toThrow(/requires authorize/)
    expect(() => createZebricMcpNodeHandler(options)).toThrow(/requires authorize/)
    await expect(startZebricMcpHttpServer({ ...options, host: '0.0.0.0', port: 0 })).rejects.toThrow(/requires authorize/)
    expect(() => createZebricMcpHttpHandler({ ...options, allowUnauthenticated: true })).not.toThrow()
    expect(() => createZebricMcpNodeHandler({ ...options, allowUnauthenticated: true })).not.toThrow()
  })

  it.each([{ maxRequestBytes: 0 }, { maxConcurrentRequests: Infinity }, { requestBodyTimeoutMs: 0 }, { discoveryCacheTtlMs: -1 }])('rejects invalid security limits %j', limits => {
    expect(() => createZebricMcpHttpHandler({ applicationUrl: 'https://app.example', authorize, ...limits })).toThrow()
    expect(() => createZebricMcpNodeHandler({ applicationUrl: 'https://app.example', authorize, ...limits })).toThrow()
  })

  it('permits a loopback listener while enforcing its Host allowlist', async () => {
    const upstream = application()
    const server = await startZebricMcpHttpServer({ applicationUrl: 'https://app.example', fetch: upstream, port: 0 })
    servers.push(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No TCP address')
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = nodeRequest(`http://127.0.0.1:${address.port}/mcp`, {
        method: 'POST', headers: { ...headers, host: 'evil.example' },
      }, response => { response.resume(); resolve(response.statusCode) })
      outgoing.on('error', reject)
      outgoing.end(list)
    })
    expect(status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe.each(['worker', 'node'] as const)('%s HTTP security regressions', mode => {
  async function setup(overrides: Partial<ZebricMcpHttpOptions> = {}) {
    const upstream = application()
    const options: ZebricMcpHttpOptions = {
      applicationUrl: 'https://app.example', fetch: upstream, credential: () => 'upstream-secret',
      allowedMutations: ['items_create'], authorize, ...overrides,
    }
    let post: (chunks: string[], extraHeaders?: Record<string, string>, keepOpen?: boolean) => Promise<Response>
    if (mode === 'worker') {
      const handler = createZebricMcpHttpHandler(options)
      post = (chunks, extraHeaders, keepOpen = false) => handler(new Request('https://worker.example/mcp', {
        method: 'POST', headers: { ...headers, authorization: 'Bearer client-secret', ...extraHeaders },
        body: new ReadableStream<Uint8Array>({ start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
          if (!keepOpen) controller.close()
        } }), duplex: 'half',
      } as RequestInit))
    } else {
      const server = await startZebricMcpHttpServer({ ...options, port: 0 })
      servers.push(server)
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No TCP address')
      post = (chunks, extraHeaders, keepOpen = false) => new Promise((resolve, reject) => {
        let responseStarted = false
        const outgoing = nodeRequest(`http://127.0.0.1:${address.port}/mcp`, {
          method: 'POST', headers: { ...headers, authorization: 'Bearer client-secret', ...extraHeaders },
        }, incoming => {
          responseStarted = true
          const buffers: Buffer[] = []
          incoming.on('data', chunk => buffers.push(chunk))
          incoming.on('error', reject)
          incoming.on('end', () => resolve(new Response(Buffer.concat(buffers), { status: incoming.statusCode })))
        })
        outgoing.on('error', reject)
        // Yield between upload chunks so the client can consume an early 413 response.
        void (async () => {
          for (const chunk of chunks) {
            for (let offset = 0; offset < chunk.length && !responseStarted; offset += 16_384) {
              outgoing.write(chunk.slice(offset, offset + 16_384))
              await new Promise<void>(resolve => setTimeout(resolve, 1))
            }
          }
          if (!keepOpen) outgoing.end()
        })().catch(reject)
      })
    }
    return { upstream, post }
  }

  it('rejects unauthenticated reads and mutations before any upstream access', async () => {
    const { upstream, post } = await setup()
    for (const body of [read, write]) {
      expect((await post([body], { authorization: '' })).status).toBe(401)
      expect((await post([body], { authorization: 'Bearer incorrect' })).status).toBe(401)
    }
    expect(upstream).not.toHaveBeenCalled()
    for (const body of [read, write]) {
      const response = await post([body])
      expect(response.status).toBe(200)
      expect((await response.json()).result.isError).toBeUndefined()
    }
    expect(upstream.mock.calls.filter(([input]) => String(input).endsWith('/items'))).toHaveLength(2)
  })

  it('rejects malformed bodies, envelopes, headers and protocol versions before discovery', async () => {
    const { upstream, post } = await setup()
    for (const body of ['{', '{}', '[]', '{"jsonrpc":"1.0","id":1,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}', `[${list},${list}]`]) {
      expect((await post([body])).status).toBe(400)
    }
    expect((await post([list], { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await post([list], { accept: 'application/json' })).status).toBe(406)
    expect((await post([list], { 'mcp-protocol-version': 'invalid' })).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
    expect((await post([list])).status).toBe(200)
  })

  it('rejects oversized declared and chunked bodies before discovery, counts UTF-8 bytes, and releases capacity', async () => {
    const { upstream, post } = await setup({ maxRequestBytes: 128, maxConcurrentRequests: 1 })
    expect((await post(['x'.repeat(129)], { 'content-length': '129' })).status).toBe(413)
    expect((await post(['x'.repeat(80), 'x'.repeat(80)])).status).toBe(413)
    expect((await post(['é'.repeat(65)])).status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
    expect((await post([list])).status).toBe(200)
  })

  it('rejects the original 2 MiB repro using the default body limit', async () => {
    const { upstream, post } = await setup()
    const large = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { padding: 'x'.repeat(2 * 1024 * 1024) } } })
    expect((await post([large])).status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('times out incomplete bodies and releases the request slot without discovery', async () => {
    const { upstream, post } = await setup({ requestBodyTimeoutMs: 30, maxConcurrentRequests: 1 })
    expect((await post(['{'], {}, true)).status).toBe(408)
    expect(upstream).not.toHaveBeenCalled()
    expect((await post([list])).status).toBe(200)
  })

  it('accepts a body exactly at the configured byte limit', async () => {
    const { post } = await setup({ maxRequestBytes: new TextEncoder().encode(list).byteLength })
    expect((await post([list])).status).toBe(200)
  })

  it('coalesces concurrent discovery, reuses its bounded cache, and expires the contract', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { upstream, post } = await setup({ discoveryCacheTtlMs: 100 })
    const responses = await Promise.all([post([list]), post([list]), post([list])])
    expect(responses.map(response => response.status)).toEqual([200, 200, 200])
    expect(upstream).toHaveBeenCalledTimes(2)
    expect((await post([list])).status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(2)
    now += 101
    expect((await post([list])).status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(4)
  })

  it('caps concurrent requests and recovers after failed discovery', async () => {
    const { upstream, post } = await setup({ maxConcurrentRequests: 1 })
    let rejectDiscovery!: (error: Error) => void
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    upstream.mockImplementationOnce(() => { entered(); return new Promise((_resolve, reject) => { rejectDiscovery = reject }) })
    const first = post([list]).catch(() => undefined)
    await started
    expect((await post([list])).status).toBe(503)
    expect(upstream).toHaveBeenCalledTimes(1)
    rejectDiscovery(new Error('Discovery failed'))
    await first
    expect((await post([list])).status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(3)
  })

  it('isolates request-specific credentials across concurrent agents while sharing discovery', async () => {
    const discovery = application()
    const fetcher = vi.fn<NonNullable<ZebricMcpHttpOptions['fetch']>>(async (input, init, request) => {
      if (String(input).endsWith('/items')) {
        const credential = new Headers(init?.headers).get('authorization')
        expect(credential).toBe(request.headers.get('authorization'))
        expect(['Bearer agent-A', 'Bearer agent-B']).toContain(credential)
        return Response.json({ identity: credential === 'Bearer agent-A' ? 'Alice' : 'Bob' })
      }
      return discovery(input, init)
    })
    const { post } = await setup({
      fetch: fetcher,
      authorize: request => ['Bearer agent-A', 'Bearer agent-B'].includes(request.headers.get('authorization') ?? ''),
      credential: async request => {
        await new Promise(resolve => setTimeout(resolve, 1))
        return request.headers.get('authorization')?.slice(7)
      },
    })
    const results = await Promise.all(['agent-A', 'agent-B', 'agent-A'].map(async agent => {
      const response = await post([read], { authorization: `Bearer ${agent}` })
      const output = await response.json()
      expect(JSON.parse(output.result.content[0].text)).toEqual({ identity: agent === 'agent-A' ? 'Alice' : 'Bob' })
      return response.status
    }))
    expect(results).toEqual([200, 200, 200])
    expect(discovery).toHaveBeenCalledTimes(2)
  })

  it('preserves structured API errors and redacts credentials in text and structured output', async () => {
    const discovery = application()
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/items')) return Response.json({ error: {
        code: 'TRANSACTION_CONFLICT', message: 'Please retry the request; upstream-secret', retryable: true,
        requestId: 'req-conflict', details: { reason: 'upstream-secret' },
      } }, { status: 409 })
      return discovery(input, init)
    })
    const { post } = await setup({ fetch: fetcher })
    const result = await (await post([write])).json()
    expect(result.result.isError).toBe(true)
    expect(result.result.structuredContent).toEqual({ error: {
      code: 'TRANSACTION_CONFLICT', message: 'Please retry the request; [REDACTED]', retryable: true,
      status: 409, kind: 'conflict', requestId: 'req-conflict', details: { reason: '[REDACTED]' },
    } })
    expect(JSON.parse(result.result.content[0].text)).toEqual(result.result.structuredContent)
    expect(JSON.stringify(result)).not.toContain('upstream-secret')
  })

  it('redacts credentials from the response-header request ID fallback', async () => {
    const discovery = application()
    const fetcher = vi.fn<typeof fetch>(async (input, init) => String(input).endsWith('/items')
      ? Response.json({ error: { code: 'DENIED', message: 'Denied', retryable: false } }, { status: 403, headers: { 'x-request-id': 'echo-upstream-secret' } })
      : discovery(input, init))
    const { post } = await setup({ fetch: fetcher })
    const result = await (await post([read])).json()
    expect(result.result.structuredContent.error.requestId).toBe('echo-[REDACTED]')
    expect(JSON.stringify(result)).not.toContain('upstream-secret')
  })
})
