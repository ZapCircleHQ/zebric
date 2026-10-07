import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { CreateZebricMcpServerOptions } from './server.js'
import { createHttpRequestState, readMcpHttpBody } from './http-security.js'

export interface ZebricMcpHttpOptions extends Omit<CreateZebricMcpServerOptions, 'eventStream' | 'contract'> {
  /** Explicit opt-in for public applications or authentication enforced by a gateway. */
  allowUnauthenticated?: boolean
  /** Maximum incoming body bytes. Defaults to 1,000,000. */
  maxRequestBytes?: number
  /** Deadline to receive a complete body. Defaults to 15s. */
  requestBodyTimeoutMs?: number
  /** Maximum simultaneous requests per handler. Defaults to 16. */
  maxConcurrentRequests?: number
  /** Cache one discovery contract for this duration. Defaults to 30s; zero disables reuse. */
  discoveryCacheTtlMs?: number
  /** Endpoint path. Defaults to /mcp. */
  path?: string
  /** Allowed browser origins. Origins are rejected by default. */
  allowedOrigins?: readonly string[]
  /** Optional Host allowlist, including ports. Recommended for local listeners. */
  allowedHosts?: readonly string[]
  /** Authenticate incoming MCP requests before accessing the application. */
  authorize?: (request: Request) => boolean | Promise<boolean>
}

/** Shared security and routing checks for Node and Web Standard HTTP adapters. */
export async function validateMcpHttpRequest(
  url: URL,
  headers: Headers,
  options: ZebricMcpHttpOptions,
): Promise<Response | undefined> {
  if (url.pathname !== (options.path ?? '/mcp')) return new Response('Not found', { status: 404 })
  if (options.allowedHosts && !options.allowedHosts.includes(headers.get('host') ?? url.host)) {
    return new Response('Forbidden host', { status: 403 })
  }
  const origin = headers.get('origin')
  if (origin !== null && !options.allowedOrigins?.includes(origin)) {
    return new Response('Forbidden origin', { status: 403 })
  }
}

/** Stateless Streamable HTTP for Workers, Hono, and other Request/Response runtimes. */
export function createZebricMcpHttpHandler(options: ZebricMcpHttpOptions): (request: Request) => Promise<Response> {
  const resolved = { ...options }
  const state = createHttpRequestState(resolved)
  return async (request) => {
    const rejected = await validateMcpHttpRequest(new URL(request.url), request.headers, resolved)
    if (rejected) return rejected
    if (resolved.authorize && !(await resolved.authorize(request))) {
      return new Response('Unauthorized', { status: 401 })
    }
    if (request.method !== 'POST')
      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: 'POST' },
      })
    if (!state.acquire()) return new Response('Too many requests', { status: 503 })
    try {
      const body = await readMcpHttpBody(
        request.headers,
        webBodyChunks(request.body),
        state.maxRequestBytes,
        state.requestBodyTimeoutMs,
      )
      if (body instanceof Response) return body
      const server = await state.createServer()
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      try {
        await server.connect(transport)
        return await transport.handleRequest(request, body)
      } finally {
        await server.close()
      }
    } finally {
      state.release()
    }
  }
}

function webBodyChunks(body: ReadableStream<Uint8Array> | null): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      const reader = body?.getReader()
      return {
        async next() {
          const result = await reader?.read()
          return result?.done === false
            ? { value: result.value, done: false as const }
            : { value: undefined, done: true as const }
        },
        async return() {
          // Cancel directly, so a stalled pending read cannot retain a request slot.
          await reader?.cancel().catch(() => undefined)
          reader?.releaseLock()
          return { value: undefined, done: true as const }
        },
      }
    },
  }
}
