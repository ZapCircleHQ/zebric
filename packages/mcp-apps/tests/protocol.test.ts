import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createZebricMcpServer, createZebricMcpHttpHandler } from '@zebric/mcp-server'
import { ZEBRIC_VERSION } from '@zebric/runtime-core'
import { describe, expect, it, vi } from 'vitest'
import { createMcpAppsExtension, MCP_APP_MIME_TYPE } from '../src/index.js'

const views = [{ name: 'items', title: 'Items', operation: 'items_list', layout: 'table' as const }]
const endpoint = new URL('https://mcp.example/mcp')

function application() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/.well-known/zebric-agent.json')) return Response.json({ name: 'Items', openapi: '/openapi.json' })
    if (url.endsWith('/openapi.json')) return Response.json({ openapi: '3.1.0', info: { title: 'Items', version: '1' }, paths: {
      '/items': { get: { operationId: 'items_list' }, post: { operationId: 'items_create' } },
    } })
    if (new Headers(init?.headers).get('authorization') !== 'Bearer app-secret') return Response.json({ error: 'Unauthorized' }, { status: 401 })
    return Response.json([{ id: '1', title: 'First' }])
  })
}

describe('MCP Apps protocol', () => {
  it.each(['memory', 'http'] as const)('discovers tools and resources, reads HTML, and retains text results over %s', async transport => {
    const fetch = application()
    const options = {
      applicationUrl: 'https://app.example', applicationName: 'custom', fetch,
      credential: () => 'app-secret', eventStream: false,
      configureServer: createMcpAppsExtension(views),
    }
    const client = new Client({ name: 'test', version: '1' })
    let closeServer: (() => Promise<void>) | undefined
    try {
      if (transport === 'memory') {
        const server = await createZebricMcpServer(options)
        closeServer = () => server.close()
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        await server.connect(serverTransport)
        await client.connect(clientTransport)
      } else {
        const handler = createZebricMcpHttpHandler({ ...options, authorize: () => true })
        await client.connect(new StreamableHTTPClientTransport(endpoint, { fetch: (input, init) => handler(new Request(input, init)) }))
      }
      const { tools } = await client.listTools()
      const tool = tools.find(tool => tool.name === 'custom_items_list')!
      expect(tool._meta?.ui).toEqual({ resourceUri: 'ui://zebric/items.html', visibility: ['model', 'app'] })
      expect(tool._meta?.['zebric/operationId']).toBe('items_list')
      expect(tool.annotations?.readOnlyHint).toBe(true)
      expect(tools.some(tool => tool.name === 'custom_items_create')).toBe(false)
      expect((await client.listResources()).resources).toEqual([expect.objectContaining({ uri: 'ui://zebric/items.html', mimeType: MCP_APP_MIME_TYPE })])
      const result = await client.readResource({ uri: 'ui://zebric/items.html' })
      const resource = result.contents[0]
      expect(resource._meta?.ui).toEqual({ csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true })
      expect(resource.text).toContain('<!DOCTYPE html>')
      expect(resource.text).toContain('custom_items_list')
      expect(resource.text).toContain(`"version":"${ZEBRIC_VERSION}"`)
      expect(resource.text).not.toContain('app-secret')
      expect(resource.text).not.toContain('First')
      expect((await client.callTool({ name: tool.name, arguments: {} })).content).toEqual([{ type: 'text', text: '[{"id":"1","title":"First"}]' }])
      await expect(client.readResource({ uri: 'ui://zebric/missing.html' })).rejects.toThrow()
    } finally {
      await client.close()
      await closeServer?.()
    }
  })

  it('refuses unknown operations and mutations outside the allowlist', async () => {
    for (const operation of ['missing', 'items_create']) {
      await expect(createZebricMcpServer({
        applicationUrl: 'https://app.example', fetch: application(), eventStream: false,
        configureServer: createMcpAppsExtension([{ ...views[0], operation }]),
      })).rejects.toThrow(`unavailable operation "${operation}"`)
    }
  })

  it('lets an explicitly allowed mutation have a result view without a refresh action', async () => {
    const server = await createZebricMcpServer({
      applicationUrl: 'https://app.example', fetch: application(), eventStream: false,
      allowedMutations: ['items_create'],
      configureServer: createMcpAppsExtension([{ ...views[0], operation: 'items_create', layout: 'detail' }]),
    })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '1' })
    try {
      await server.connect(b)
      await client.connect(a)
      const resource = (await client.readResource({ uri: 'ui://zebric/items.html' })).contents[0]
      expect(resource.text).toContain('"readOnly":false')
      const tool = (await client.listTools()).tools.find(tool => tool.name === 'zebric_items_create')!
      expect(tool._meta?.ui).toEqual({ resourceUri: 'ui://zebric/items.html', visibility: ['model'] })
    } finally { await client.close(); await server.close() }
  })

  it('authenticates resource reads and isolates caller credentials through the HTTP handler', async () => {
    const fetch = application()
    const handler = createZebricMcpHttpHandler({
      applicationUrl: 'https://app.example', fetch,
      authorize: request => request.headers.has('authorization'),
      credential: request => request.headers.get('authorization')?.slice(7),
      configureServer: createMcpAppsExtension(views),
    })
    const post = (method: string, token?: string) => handler(new Request(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: method === 'resources/read' ? { uri: 'ui://zebric/items.html' } : { name: 'zebric_items_list', arguments: {} } }),
    }))
    expect((await post('resources/read')).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
    const [success, failure] = await Promise.all(['app-secret', 'wrong-secret'].map(async token => (await post('tools/call', token)).json()))
    expect(success.result.isError).not.toBe(true)
    expect(failure.result.isError).toBe(true)
  })
})
