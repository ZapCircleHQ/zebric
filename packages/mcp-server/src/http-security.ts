import {
  ClientRequestSchema,
  JSONRPCMessageSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js'
import { discoverZebricApplication, type ZebricApplicationContract } from '@zebric/agent/runtime'
import { createZebricMcpServer } from './server.js'
import type { ZebricMcpHttpOptions } from './http.js'

export function createHttpRequestState(options: ZebricMcpHttpOptions) {
  if (!options.authorize && options.allowUnauthenticated !== true) {
    throw new TypeError('HTTP MCP requires authorize or explicit allowUnauthenticated: true')
  }
  const maxRequestBytes = options.maxRequestBytes ?? 1_000_000
  const maxConcurrentRequests = options.maxConcurrentRequests ?? 16
  const requestBodyTimeoutMs = options.requestBodyTimeoutMs ?? 15_000
  const discoveryCacheTtlMs = options.discoveryCacheTtlMs ?? 30_000
  for (const [name, value] of Object.entries({
    maxRequestBytes,
    maxConcurrentRequests,
    requestBodyTimeoutMs,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`)
  }
  if (!Number.isFinite(discoveryCacheTtlMs) || discoveryCacheTtlMs < 0) {
    throw new TypeError('discoveryCacheTtlMs must be finite and nonnegative')
  }
  if (requestBodyTimeoutMs > 2_147_483_647) throw new TypeError('requestBodyTimeoutMs exceeds the timer range')
  let active = 0
  let discovery: Promise<ZebricApplicationContract> | undefined
  let expires = 0
  const resolved = {
    ...options,
    allowedMutations: [...(options.allowedMutations ?? [])],
  }
  return {
    maxRequestBytes,
    requestBodyTimeoutMs,
    acquire(): boolean {
      if (active >= maxConcurrentRequests) return false
      active++
      return true
    },
    release() {
      active--
    },
    async createServer(request: Request) {
      const fetcher: typeof globalThis.fetch | undefined = resolved.fetch
        ? (input, init) => resolved.fetch!(input, init, request)
        : undefined
      if (!discovery || Date.now() >= expires) {
        // Single flight for concurrent discovery; keep only one contract per handler.
        expires = Infinity
        discovery = discoverZebricApplication(options.applicationUrl, {
          fetch: fetcher,
          timeoutMs: options.timeoutMs,
        }).then(
          (contract) => {
            expires = Date.now() + discoveryCacheTtlMs
            return contract
          },
          (error) => {
            discovery = undefined
            expires = 0
            throw error
          },
        )
      }
      return createZebricMcpServer({
        ...resolved,
        fetch: fetcher,
        credential: resolved.credential ? () => resolved.credential!(request) : undefined,
        eventStream: false,
        contract: await discovery,
      })
    },
  }
}

/** Validate and bound the incoming stream before discovery or SDK parsing. */
export async function readMcpHttpBody(
  headers: Headers,
  chunks: AsyncIterable<Uint8Array>,
  maxBytes: number,
  timeoutMs: number,
): Promise<{ parsedBody: unknown } | Response> {
  const accept = headers.get('accept') ?? ''
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    return new Response('Not acceptable', { status: 406 })
  }
  if (headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return new Response('Unsupported media type', { status: 415 })
  }
  const length = headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    return new Response('Request body too large', { status: 413 })
  }
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  const iterator = chunks[Symbol.asyncIterator]()
  let timedOut = false
  let timer!: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error('Request body timed out'))
    }, timeoutMs)
  })
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), deadline])
      if (next.done) break
      const chunk = next.value
      bytes += chunk.byteLength
      if (bytes > maxBytes) return new Response('Request body too large', { status: 413 })
      text += decoder.decode(chunk, { stream: true })
    }
    text += decoder.decode()
    const parsedBody: unknown = JSON.parse(text)
    const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody]
    if (messages.length === 0) throw new Error('Empty batch')
    const requestIds = new Set<string | number>()
    for (const message of messages) {
      const parsed = JSONRPCMessageSchema.parse(message)
      if ('method' in parsed && 'id' in parsed) {
        if (requestIds.has(parsed.id)) throw new Error('Duplicate request ID')
        requestIds.add(parsed.id)
      }
      if ('method' in parsed && ['initialize', 'tools/list', 'tools/call', 'ping'].includes(parsed.method)) {
        ClientRequestSchema.parse(parsed)
      }
    }
    const initializing = messages.some((message) => (message as { method?: string }).method === 'initialize')
    if (initializing && messages.length > 1) throw new Error('Invalid initialization batch')
    const protocol = headers.get('mcp-protocol-version')
    if (!initializing && protocol && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocol)) {
      return new Response('Unsupported protocol version', { status: 400 })
    }
    return { parsedBody }
  } catch {
    return new Response(timedOut ? 'Request body timed out' : 'Invalid JSON-RPC body', { status: timedOut ? 408 : 400 })
  } finally {
    clearTimeout(timer)
    // Node may still have a pending read; its response closes the connection on rejection.
    void iterator.return?.().catch(() => undefined)
  }
}
