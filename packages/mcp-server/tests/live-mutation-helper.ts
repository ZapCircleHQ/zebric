import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createZebricMcpServer } from '../src/server.js'

/** Exercise the MCP tools/call boundary against either runtime's HTTP adapter. */
export async function mutateThroughMcp(
  fetchRuntime: (path: string, init?: RequestInit) => Promise<Response>,
  applicationUrl = 'https://test.example',
): Promise<void> {
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    return fetchRuntime(url.pathname + url.search, { method: request.method, headers: request.headers, signal: request.signal, redirect: request.redirect,
      ...(request.method === 'GET' ? {} : { body: await request.text() }) })
  }
  const openapi = await (await fetchRuntime('/api/openapi.json')).json() as { paths: Record<string, { post?: { operationId: string } }> }
  const operation = Object.entries(openapi.paths).find(([path, value]) => path.includes('/api/commands/') && value.post)?.[1]
  if (!operation?.post) throw new Error('Missing PublishItem command operation')
  const operationId = operation.post.operationId
  const server = await createZebricMcpServer({ applicationUrl, applicationName: 'live',
    credential: () => 'writer-key', allowedMutations: [operationId], eventStream: false, fetch: fetcher })
  const client = new Client({ name: 'live-integration', version: '1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const tools = await client.listTools()
    const tool = tools.tools.find(candidate => candidate._meta?.['zebric/operationId'] === operationId)!
    const result = await client.callTool({ name: tool.name, arguments: { id: 'source' } })
    if (result.isError) throw new Error(JSON.stringify(result))
  } finally {
    await client.close()
    await server.close()
  }
}
