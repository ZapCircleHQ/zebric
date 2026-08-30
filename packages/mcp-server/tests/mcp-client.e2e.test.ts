import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Zebric MCP stdio release gate', () => {
  let application: Server
  let applicationUrl: string
  let requestedPath: string | undefined

  beforeEach(async () => {
    application = createServer((request, response) => {
      if (request.url === '/.well-known/zebric-agent.json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ name: 'Test App', version: '1.0.0', openapi: '/api/openapi.json' }))
        return
      }
      if (request.url === '/api/openapi.json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Test App', version: '1.0.0' },
          paths: {
            '/api/items': {
              get: {
                operationId: 'items_list',
                description: 'List items by status.',
                parameters: [{
                  name: 'status', in: 'query', required: false,
                  schema: { type: 'string', enum: ['ready', 'done'] },
                }],
              },
              post: {
                operationId: 'items_create',
                description: 'Create an item.',
                'x-zebric-agent-operation': {
                  risk: 'write', approvalRequired: true, idempotencyRequired: true,
                  asynchronous: false, requiredScopes: [],
                },
                requestBody: { content: { 'application/json': { schema: {
                  type: 'object', properties: { title: { type: 'string' } }, required: ['title'],
                } } } },
              },
            },
          },
        }))
        return
      }
      if (request.url?.startsWith('/api/items')) {
        requestedPath = request.url
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify([{ id: 'item-1', status: 'ready' }]))
        return
      }
      response.statusCode = 404
      response.end()
    })
    application.listen(0, '127.0.0.1')
    await once(application, 'listening')
    const address = application.address()
    if (!address || typeof address === 'string') throw new Error('Test application did not bind a TCP port')
    applicationUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    application.close()
    await once(application, 'close')
  })

  it('initializes, lists generated tools, and calls one through an official MCP client', async () => {
    const client = new Client({ name: 'zebric-release-gate', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dirname, '../dist/cli.js'), '--connect', applicationUrl],
      stderr: 'pipe',
    })
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      expect(listed.tools).toEqual([expect.objectContaining({
        name: 'zebric_items_list',
        description: 'List items by status.',
        inputSchema: expect.objectContaining({ type: 'object' }),
        annotations: expect.objectContaining({ readOnlyHint: true }),
      })])

      const result = await client.callTool({
        name: 'zebric_items_list',
        arguments: { status: 'ready' },
      })
      expect(result.isError).not.toBe(true)
      expect(result.content).toEqual([{ type: 'text', text: '[{"id":"item-1","status":"ready"}]' }])
      expect(requestedPath).toBe('/api/items?status=ready')
    } finally {
      await client.close()
    }
  })
})
