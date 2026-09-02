import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createZebricMcpServer, type ZebricMcpServer } from '../src/server.js'

const BASE = 'https://app.example.test'

const DISCOVERY = { name: 'Test App', version: '1.0.0', openapi: '/api/openapi.json', events: '/api/agent/events' }
const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Test App', version: '1.0.0' },
  paths: { '/api/items': { get: { operationId: 'items_list', description: 'List items.' } } },
}

const ChannelNotificationSchema = z.object({
  method: z.literal('notifications/claude/channel'),
  params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()).optional() }),
})

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
}

interface Harness {
  fetch: typeof globalThis.fetch
  push(raw: string): void
  pushRawChunk(text: string): void
}

function createHarness(eventStream?: (init?: RequestInit) => Response | Promise<Response>): Harness {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith('/.well-known/zebric-agent.json')) return jsonResponse(DISCOVERY)
    if (url.endsWith('/api/openapi.json')) return jsonResponse(OPENAPI)
    if (url.endsWith('/api/agent/events')) {
      if (eventStream) return eventStream(init)
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
          c.enqueue(encoder.encode(': connected\n\n'))
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (url.includes('/api/items')) return jsonResponse([{ id: 'item-1' }])
    return new Response('not found', { status: 404 })
  }) as unknown as typeof globalThis.fetch
  return {
    fetch: fetchMock,
    push: raw => controller?.enqueue(encoder.encode(`data: ${raw}\n\n`)),
    pushRawChunk: text => controller?.enqueue(encoder.encode(text)),
  }
}

async function connectClient(server: ZebricMcpServer) {
  const client = new Client({ name: 'event-stream-test', version: '1.0.0' })
  const events: Array<z.infer<typeof ChannelNotificationSchema>['params']> = []
  client.setNotificationHandler(ChannelNotificationSchema, notification => void events.push(notification.params))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, events }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const validEvent = JSON.stringify({
  id: 'evt-1', type: 'entity.create', occurredAt: '2026-09-02T00:00:00Z', data: { entity: 'Item', id: 'item-1' },
})

let active: ZebricMcpServer | undefined
afterEach(async () => {
  await active?.close()
  active = undefined
  vi.restoreAllMocks()
})

describe('event-stream hardening', () => {
  it('discards malformed and schema-invalid events but still forwards valid ones', async () => {
    const harness = createHarness()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    active = await createZebricMcpServer({ applicationUrl: BASE, fetch: harness.fetch })
    const { events } = await connectClient(active)

    harness.push('this is not json')
    harness.push(JSON.stringify({ id: 'evt-x' })) // missing required fields
    harness.push(JSON.stringify({ id: 'e', type: 'x', occurredAt: 't', data: 'not-an-object' }))
    harness.push(validEvent)

    await waitFor(() => events.length >= 1)
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(events).toHaveLength(1)
    expect(events[0]!.content).toContain('entity.create')
    expect(events[0]!.meta?.event_id).toBe('evt-1')
    expect(errors).toHaveBeenCalled()
  })

  it('recycles the connection when a record exceeds the buffer cap instead of buffering unbounded', async () => {
    const harness = createHarness()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    active = await createZebricMcpServer({ applicationUrl: BASE, fetch: harness.fetch })
    const { client } = await connectClient(active)

    harness.pushRawChunk(`data: ${'x'.repeat(300_000)}`) // no record boundary

    await waitFor(() => errors.mock.calls.some(call => String(call[0]).includes('oversized record')))
    // Server is still responsive after tearing down the abusive stream.
    await expect(client.listTools()).resolves.toBeTruthy()
  })

  it('rejects startup when the event stream never sends response headers', async () => {
    const harness = createHarness(init => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new Error('aborted')), { once: true })
    }))
    await expect(
      createZebricMcpServer({ applicationUrl: BASE, fetch: harness.fetch, timeoutMs: 100 }),
    ).rejects.toThrow(/timed out/i)
  })

  it('rejects an event stream that resolves to a different origin', async () => {
    const harness = createHarness(() => {
      const response = new Response(new ReadableStream({ start: c => c.close() }), {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      })
      Object.defineProperty(response, 'url', { value: 'https://evil.example.test/stream' })
      return response
    })
    await expect(
      createZebricMcpServer({ applicationUrl: BASE, fetch: harness.fetch }),
    ).rejects.toThrow(/redirected off the application origin/)
  })
})
