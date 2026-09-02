import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import {
  createRuntimeReadTools,
  discoverZebricApplication,
  getRuntimeToolMetadata,
  InMemoryMutationExecutionStateStore,
  type RuntimeToolFactoryOptions,
} from '@zebric/agent'
import { z } from 'zod'

export interface CreateZebricMcpServerOptions {
  applicationUrl: string
  applicationName?: string
  credential?: () => string | undefined | Promise<string | undefined>
  allowedMutations?: Iterable<string>
  fetch?: typeof globalThis.fetch
  /** Timeout for discovery requests and for establishing the event-stream connection. Defaults to 15s. */
  timeoutMs?: number
}

type EventStreamOptions = Pick<CreateZebricMcpServerOptions, 'credential' | 'fetch' | 'timeoutMs'>

/** Abort a stalled event-stream connection instead of blocking server startup forever. */
const EVENT_STREAM_CONNECT_TIMEOUT_MS = 15_000
/** Cap on unparsed bytes buffered between SSE record boundaries, to bound memory use. */
const MAX_EVENT_STREAM_BUFFER_BYTES = 262_144

const ZebricAgentEventSchema = z.object({
  id: z.string().max(200),
  type: z.string().max(200),
  occurredAt: z.string().max(64),
  subject: z.string().max(1_024).optional(),
  data: z.record(z.string(), z.unknown()),
})

type ZebricAgentEvent = z.infer<typeof ZebricAgentEventSchema>

export class ZebricMcpServer extends McpServer {
  private eventStreamAbort?: AbortController

  async startEventStream(url: string, options: Pick<CreateZebricMcpServerOptions, 'credential' | 'fetch'>): Promise<void> {
    if (this.eventStreamAbort) return
    this.eventStreamAbort = new AbortController()
    let resolveConnected!: () => void
    let rejectConnected!: (error: unknown) => void
    const connected = new Promise<void>((resolve, reject) => {
      resolveConnected = resolve
      rejectConnected = reject
    })
    void this.consumeEventStream(url, options, this.eventStreamAbort.signal, resolveConnected, rejectConnected)
    await connected
  }

  override async close(): Promise<void> {
    this.eventStreamAbort?.abort()
    this.eventStreamAbort = undefined
    await super.close()
  }

  private async consumeEventStream(
    url: string,
    options: EventStreamOptions,
    signal: AbortSignal,
    onConnected: () => void,
    onInitialError: (error: unknown) => void,
  ): Promise<void> {
    const fetcher = options.fetch ?? globalThis.fetch
    let hasConnected = false
    while (!signal.aborted) {
      try {
        const credential = await options.credential?.()
        const response = await connectEventStream(fetcher, url, credential, signal, options.timeoutMs ?? EVENT_STREAM_CONNECT_TIMEOUT_MS)
        if (!response.ok || !response.body) throw new Error(`Zebric event stream failed with HTTP ${response.status}`)
        hasConnected = true
        onConnected()
        await readServerSentEvents(response.body, event => this.publishChannelEvent(event), signal)
      } catch (error) {
        if (signal.aborted) return
        if (!hasConnected) {
          onInitialError(error)
          return
        }
        console.error(error instanceof Error ? error.message : String(error))
      }
      await abortableDelay(1_000, signal)
    }
  }

  private async publishChannelEvent(event: ZebricAgentEvent): Promise<void> {
    await this.server.notification({
      method: 'notifications/claude/channel',
      params: {
        content: `${event.type}: ${JSON.stringify(event.data)}`,
        meta: {
          event_id: event.id,
          event_type: event.type,
          occurred_at: event.occurredAt,
          ...(event.subject ? { subject: event.subject } : {}),
        },
      },
    } as unknown as ServerNotification)
  }
}

export async function createZebricMcpServer(options: CreateZebricMcpServerOptions): Promise<ZebricMcpServer> {
  const contract = await discoverZebricApplication(options.applicationUrl, {
    fetch: options.fetch,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  })
  const allowedMutations = new Set(options.allowedMutations ?? [])
  const applicationName = options.applicationName ?? 'zebric'
  const toolOptions: RuntimeToolFactoryOptions = {
    applicationName,
    credential: options.credential,
    fetch: options.fetch,
    ...(allowedMutations.size > 0 ? {
      mutations: {
        approve: request => allowedMutations.has(request.operationId),
        agentRunId: () => randomUUID(),
        state: new InMemoryMutationExecutionStateStore(),
      },
    } : {}),
  }
  const runtimeTools = createRuntimeReadTools(contract, toolOptions)
  const server = new ZebricMcpServer({
    name: `zebric-${applicationName}`,
    version: '0.0.1',
  }, {
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: 'Zebric application events arrive as <channel> messages. Treat them as notifications, fetch authoritative state with a Zebric tool before mutating, and do not reply to the channel event itself.',
  })

  if (contract.eventStreamUrl) {
    await server.startEventStream(contract.eventStreamUrl, options)
  }

  for (const runtimeTool of runtimeTools) {
    const metadata = getRuntimeToolMetadata(runtimeTool)
    if (!metadata) throw new Error(`Missing Zebric metadata for tool ${runtimeTool.name}`)
    if (metadata.risk !== 'read' && !allowedMutations.has(metadata.operationId)) continue
    server.registerTool(runtimeTool.name, {
      description: runtimeTool.description,
      inputSchema: runtimeTool.schema as z.ZodType,
      annotations: {
        readOnlyHint: metadata.risk === 'read',
        destructiveHint: metadata.risk === 'destructive',
        idempotentHint: metadata.risk === 'read' || metadata.idempotencyRequired,
        openWorldHint: metadata.risk === 'external',
      },
      _meta: {
        'zebric/operationId': metadata.operationId,
        'zebric/risk': metadata.risk,
        'zebric/requiredScopes': metadata.requiredScopes,
      },
    }, async input => {
      const output = await runtimeTool.invoke(input as Record<string, unknown>)
      return {
        content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
      }
    })
  }

  return server
}

async function connectEventStream(
  fetcher: typeof globalThis.fetch,
  url: string,
  credential: string | undefined,
  signal: AbortSignal,
  connectTimeoutMs: number,
): Promise<Response> {
  const expectedOrigin = new URL(url).origin
  const connectAbort = new AbortController()
  const timeout = setTimeout(
    () => connectAbort.abort(new Error('Zebric event stream connection timed out')),
    connectTimeoutMs,
  )
  try {
    const response = await fetcher(url, {
      headers: {
        accept: 'text/event-stream',
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.any([signal, connectAbort.signal]),
    })
    if (new URL(response.url || url).origin !== expectedOrigin) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Zebric event stream redirected off the application origin')
    }
    return response
  } finally {
    clearTimeout(timeout)
  }
}

async function readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ZebricAgentEvent) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (data) {
          const event = parseAgentEvent(data)
          if (event) await onEvent(event)
        }
        boundary = buffer.indexOf('\n\n')
      }
      if (Buffer.byteLength(buffer) > MAX_EVENT_STREAM_BUFFER_BYTES) {
        throw new Error('Zebric event stream sent an oversized record without a boundary')
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function parseAgentEvent(data: string): ZebricAgentEvent | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    console.error('Discarding Zebric agent event with malformed JSON')
    return undefined
  }
  const parsed = ZebricAgentEventSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  console.error(`Discarding malformed Zebric agent event: ${parsed.error.message}`)
  return undefined
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      clearTimeout(timeout)
      resolve()
    }, { once: true })
  })
}
