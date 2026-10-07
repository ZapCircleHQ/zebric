import { describe, expect, it, vi } from 'vitest'
import { generateWorkersOpenApi } from '../../runtime-worker/src/api/discovery.js'
import { createZebricMcpHttpHandler } from '../src/http.js'

const blueprint = {
  version: '0.6.0',
  project: { name: 'Worker', version: '1.0.0', runtime: { min_version: '0.6.0' } },
  entities: [{ name: 'Item', fields: [{ name: 'id', type: 'ULID', primary_key: true }] }],
  pages: [],
  commands: [{ name: 'ApproveItem', entity: 'Item', mutations: {} }],
} as Parameters<typeof generateWorkersOpenApi>[0]

describe('generated Workers MCP contract', () => {
  it('lists and invokes real Workers tools without a redirect or event-operation shim', async () => {
    const spec = generateWorkersOpenApi(blueprint)
    expect(spec.paths['/api/agent/events']?.get?.operationId).toBe('stream_agent_events')
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.redirect).toBe('manual')
      new Request(input, init)
      const url = String(input)
      if (url.endsWith('/.well-known/zebric-agent.json')) return Response.json({ name: 'Worker', openapi: '/api/openapi.json', events: '/api/agent/events' })
      if (url.endsWith('/api/openapi.json')) return Response.json(spec)
      if (url.endsWith('/api/agent/events')) throw new Error('Stateless HTTP must not subscribe to SSE')
      return Response.json([{ id: 'worker-item' }])
    })
    const handler = createZebricMcpHttpHandler({ applicationUrl: 'https://worker.example', fetch: fetcher, authorize: () => true, allowedMutations: ['approve_item'] })
    const post = (method: string, params: object = {}) => handler(new Request('https://worker.example/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }))
    const listed = await (await post('tools/list')).json()
    expect(listed.error).toBeUndefined()
    expect(listed.result.tools.some((tool: { name: string }) => tool.name === 'zebric_stream_agent_events')).toBe(false)
    const command = listed.result.tools.find((tool: { name: string }) => tool.name === 'zebric_approve_item')
    expect(command).toBeDefined()
    expect(command.description).not.toMatch(/^Read /)
    const read = listed.result.tools.find((tool: { annotations: { readOnlyHint: boolean }; name: string }) => tool.annotations.readOnlyHint)
    const called = await (await post('tools/call', { name: read.name, arguments: {} })).json()
    expect(called.result.content).toEqual([{ type: 'text', text: '[{"id":"worker-item"}]' }])
  })
})
