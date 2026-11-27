import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { BlueprintParser } from '@zebric/runtime-core'
import { createZebricMcpNodeHandler, startZebricMcpHttpServer } from '@zebric/mcp-server/node'
import { createZebricMcpServer } from '@zebric/mcp-server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpAppsExtension } from '../dist/index.js'

const source = await readFile(new URL('../../../examples/task-tracker/blueprint.toml', import.meta.url), 'utf8')
const blueprint = new BlueprintParser().parse(source, 'toml')
const options = {
  applicationUrl: 'http://127.0.0.1:3000',
  applicationName: 'task_tracker',
  credential: () => process.env.TASK_TRACKER_API_KEY,
  configureServer: createMcpAppsExtension(blueprint.mcp_apps ?? []),
}
if (process.argv.includes('--stdio') && process.argv.includes('--browser')) {
  throw new Error('Choose --stdio or --browser, not both')
}
if (process.argv.includes('--stdio')) {
  const server = await createZebricMcpServer({ ...options, eventStream: false })
  await server.connect(new StdioServerTransport())
} else {
  let server
  if (process.argv.includes('--browser')) {
    // Local reference-host testing only; production CORS belongs at the gateway.
    const origin = 'http://localhost:8080'
    const handler = createZebricMcpNodeHandler({
      ...options, allowUnauthenticated: true,
      allowedHosts: ['127.0.0.1:3001'], allowedOrigins: [origin],
    })
    server = createServer((request, response) => {
      const trusted = request.headers.origin === origin
      if (trusted) {
        response.setHeader('access-control-allow-origin', origin)
        response.setHeader('vary', 'Origin')
        response.setHeader('access-control-expose-headers', 'MCP-Protocol-Version, MCP-Session-Id')
      }
      if (request.method === 'OPTIONS') {
        if (!trusted || request.headers.host !== '127.0.0.1:3001' || request.url !== '/mcp') {
          response.writeHead(403).end()
          return
        }
        response.setHeader('access-control-allow-methods', 'POST')
        response.setHeader('access-control-allow-headers', 'Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID, MCP-Method, MCP-Name')
        response.writeHead(204).end()
        return
      }
      handler(request, response)
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(3001, '127.0.0.1', resolve)
    })
  } else {
    server = await startZebricMcpHttpServer(options)
  }
  console.error('Task Tracker MCP Apps: http://127.0.0.1:3001/mcp')
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
}
