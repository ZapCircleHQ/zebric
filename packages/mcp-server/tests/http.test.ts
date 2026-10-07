import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { describe, expect, it, vi } from 'vitest'
import { createZebricMcpHttpHandler } from '../src/http.js'

const endpoint = 'https://worker.example/mcp'
function application() {
  return vi.fn<typeof fetch>(async input => {
    const url = String(input)
    const body = url.endsWith('/.well-known/zebric-agent.json')
      ? { name: 'App', openapi: '/openapi.json', events: '/events' }
      : url.endsWith('/openapi.json')
        ? { openapi: '3.1.0', info: { title: 'App', version: '1' }, paths: {
          '/items': { get: { operationId: 'items_list' } },
        } }
        : [{ id: '1' }]
    if (url.endsWith('/events')) throw new Error('Stateless HTTP must not subscribe to events')
    return Response.json(body)
  })
}

describe('MCP HTTP handler', () => {
  it('checks routing, origin, host, authentication and methods before accessing the application', async () => {
    const fetch = application()
    const handler = createZebricMcpHttpHandler({
      applicationUrl: 'https://app.example', fetch,
      allowedOrigins: ['https://trusted.example'], allowedHosts: ['worker.example'],
      authorize: request => request.headers.get('authorization') === 'Bearer secret',
    })
    for (const [url, headers, method, status] of [
      ['https://worker.example/other', {}, 'POST', 404],
      [endpoint, { origin: 'https://evil.example' }, 'POST', 403],
      [endpoint, { origin: 'null' }, 'POST', 403],
      ['https://evil.example/mcp', {}, 'POST', 403],
      [endpoint, {}, 'POST', 401],
      [endpoint, { authorization: 'Bearer secret', origin: 'https://trusted.example' }, 'GET', 405],
    ] as const) {
      expect((await handler(new Request(url, { method, headers }))).status).toBe(status)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed protocol bodies', async () => {
    const handler = createZebricMcpHttpHandler({ applicationUrl: 'https://app.example', fetch: application(), authorize: () => true })
    const response = await handler(new Request(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: 'invalid json',
    }))
    expect(response.status).toBe(400)
  })

  it('isolates concurrent clients and omits persistent channel capabilities', async () => {
    const handler = createZebricMcpHttpHandler({ applicationUrl: 'https://app.example', fetch: application(), authorize: () => true })
    await Promise.all([1, 2].map(async id => {
      const client = new Client({ name: `client-${id}`, version: '1' })
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
          fetch: (input, init) => handler(new Request(input, init)),
        }))
        expect(client.getServerCapabilities()?.experimental?.['claude/channel']).toBeUndefined()
        const result = await client.callTool({ name: 'zebric_items_list', arguments: {} })
        expect(result.content).toEqual([{ type: 'text', text: '[{"id":"1"}]' }])
      } finally {
        await client.close()
      }
    }))
  })
})
