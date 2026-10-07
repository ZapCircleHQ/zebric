import { createServer, type RequestListener, type Server } from 'node:http'
import { createServer as createHttpsServer, type ServerOptions } from 'node:https'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createHttpRequestState, readMcpHttpBody } from './http-security.js'
import { validateMcpHttpRequest, type ZebricMcpHttpOptions } from './http.js'

/** Mount on an existing Node HTTP or HTTPS server. */
export function createZebricMcpNodeHandler(options: ZebricMcpHttpOptions): RequestListener {
  const resolved = {
    ...options,
    allowedMutations: [...(options.allowedMutations ?? [])],
  }
  const state = createHttpRequestState(resolved)
  return (request, response) => {
    void (async () => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const scheme = 'encrypted' in request.socket && request.socket.encrypted ? 'https' : 'http'
      const url = new URL(request.url ?? '/', `${scheme}://${headers.get('host') ?? 'localhost'}`)
      const mcpRequest = new Request(url, { headers, method: request.method })
      let rejected = await validateMcpHttpRequest(url, headers, resolved)
      if (
        !rejected &&
        resolved.authorize &&
        !(await resolved.authorize(mcpRequest))
      ) {
        rejected = new Response('Unauthorized', { status: 401 })
      }
      if (!rejected && request.method !== 'POST') {
        rejected = new Response('Method not allowed', {
          status: 405,
          headers: { allow: 'POST' },
        })
      }
      if (rejected) {
        response.writeHead(rejected.status, Object.fromEntries(rejected.headers))
        response.end(await rejected.text())
        return
      }
      if (!state.acquire()) {
        response.writeHead(503, { connection: 'close' })
        response.end('Too many requests')
        return
      }
      try {
        const body = await readMcpHttpBody(
          headers,
          request.iterator({ destroyOnReturn: false }),
          state.maxRequestBytes,
          state.requestBodyTimeoutMs,
        )
        if (body instanceof Response) {
          // Discard buffered upload bytes while flushing the rejection, then close the connection.
          request.resume()
          response.writeHead(body.status, { connection: 'close' })
          response.end(await body.text())
          return
        }
        const server = await state.createServer(mcpRequest)
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        })
        response.once('close', () => {
          void server.close()
        })
        try {
          await server.connect(transport)
          await transport.handleRequest(request, response, body.parsedBody)
        } catch (error) {
          await server.close()
          throw error
        }
      } finally {
        state.release()
      }
    })().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'MCP request failed' }))
    })
  }
}

export interface ZebricMcpNodeOptions extends ZebricMcpHttpOptions {
  host?: string
  port?: number
  /** TLS certificate/key for native HTTPS; omit when TLS terminates at a proxy. */
  tls?: ServerOptions
}

/** Start a Node listener. Use server.close() to stop accepting requests. */
export async function startZebricMcpHttpServer(options: ZebricMcpNodeOptions): Promise<Server> {
  const host = options.host ?? '127.0.0.1'
  const localHosts = host === '127.0.0.1' || host === 'localhost' || host === '::1' ? ([] as string[]) : undefined
  const handler = createZebricMcpNodeHandler({
    ...options,
    allowUnauthenticated: options.allowUnauthenticated ?? Boolean(localHosts),
    allowedHosts: options.allowedHosts ?? localHosts,
  })
  const server = options.tls ? createHttpsServer(options.tls, handler) : createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 3001, host, () => {
      const address = server.address()
      if (localHosts && address && typeof address !== 'string') {
        localHosts.push(`${host === '::1' ? '[::1]' : host}:${address.port}`)
      }
      server.removeListener('error', reject)
      resolve()
    })
  })
  return server
}
