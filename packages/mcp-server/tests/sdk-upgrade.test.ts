/**
 * Guards for the MCP SDK dependency tree: protocol behavior through the official
 * client, plus version floors for transitive packages that have had security fixes.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createZebricMcpHttpHandler } from '../src/http.js'

const endpoint = 'https://worker.example/mcp'

function application() {
  return vi.fn<typeof fetch>(async input => {
    const url = String(input)
    const body = url.endsWith('/.well-known/zebric-agent.json')
      ? { name: 'App', openapi: '/openapi.json' }
      : url.endsWith('/openapi.json')
        ? { openapi: '3.1.0', info: { title: 'App', version: '1' }, paths: {
          '/items': { get: { operationId: 'items_list' } },
        } }
        : [{ id: '1' }]
    return Response.json(body)
  })
}

async function connect(upstream = application()) {
  const handler = createZebricMcpHttpHandler({ applicationUrl: 'https://app.example', fetch: upstream, authorize: () => true })
  const client = new Client({ name: 'sdk-upgrade', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: (input, init) => handler(new Request(input, init)),
  }))
  return { client, handler, upstream }
}

describe('MCP protocol through the official client', () => {
  it('lists tools with JSON Schema input definitions', async () => {
    const { client } = await connect()
    try {
      const { tools } = await client.listTools()
      expect(tools.map(t => t.name)).toContain('zebric_items_list')
      for (const tool of tools) expect(tool.inputSchema.type).toBe('object')
    } finally {
      await client.close()
    }
  })

  it.each(['__proto__', 'constructor', 'toString', 'zebric_missing'])(
    'refuses to call the non-existent tool %s',
    async name => {
      const { client, upstream } = await connect()
      try {
        const before = upstream.mock.calls.length
        const outcome = await client.callTool({ name, arguments: {} }).then(
          result => ({ isError: result.isError === true }),
          () => ({ isError: true }),
        )
        expect(outcome.isError).toBe(true)
        // Only discovery may have happened; nothing was proxied to the app.
        expect(upstream.mock.calls.length).toBe(before)
      } finally {
        await client.close()
      }
    },
  )

  it('keeps serving after an error response', async () => {
    const { client } = await connect()
    try {
      await client.callTool({ name: 'zebric_missing', arguments: {} }).catch(() => undefined)
      const ok = await client.callTool({ name: 'zebric_items_list', arguments: {} })
      expect(ok.content).toEqual([{ type: 'text', text: '[{"id":"1"}]' }])
    } finally {
      await client.close()
    }
  })

  it('rejects JSON-RPC requests with the wrong protocol shape', async () => {
    const { handler } = await connect()
    const post = (body: unknown) => handler(new Request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }))
    for (const body of [{}, { jsonrpc: '1.0', id: 1, method: 'tools/list' }, [], 'string', null]) {
      const response = await post(body)
      expect(response.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400)
    }
  })
})

/** Minimum patched versions of transitive packages the SDK pulls in. */
const floors: Record<string, string> = {
  hono: '4.12.34',
  '@hono/node-server': '2.0.10',
  'fast-uri': '3.1.8',
  qs: '6.16.0',
  'proxy-addr': '2.0.8',
  'ip-address': '10.7.1',
}

function packageJsonFor(name: string, from: NodeRequire): string | undefined {
  // Many packages hide package.json behind an exports map, so resolve the entry
  // point and walk up to the manifest that carries the right name.
  let entry: string
  try {
    entry = from.resolve(name)
  } catch {
    return undefined
  }
  let dir = dirname(entry)
  while (dir !== dirname(dir)) {
    try {
      const file = join(dir, 'package.json')
      if (JSON.parse(readFileSync(file, 'utf8')).name === name) return file
    } catch {
      // keep walking up
    }
    dir = dirname(dir)
  }
  return undefined
}

function installedVersions(name: string): string[] {
  // Resolve from the SDK's own location so we test what the SDK actually loads,
  // including nested copies (ajv -> fast-uri, express -> proxy-addr/qs, ...).
  const sdkRequire = createRequire(require_resolve('@modelcontextprotocol/sdk/package.json'))
  const versions = new Set<string>()
  const record = (from: NodeRequire) => {
    const file = packageJsonFor(name, from)
    if (file) versions.add(JSON.parse(readFileSync(file, 'utf8')).version)
  }
  record(sdkRequire)
  for (const parent of ['ajv', 'express', 'hono', '@hono/node-server', 'express-rate-limit']) {
    const parentJson = packageJsonFor(parent, sdkRequire)
    if (parentJson) record(createRequire(parentJson))
  }
  return [...versions]
}

function require_resolve(spec: string): string {
  // The SDK's exports map may hide package.json; locate it via its main entry instead.
  const entry = createRequire(import.meta.url).resolve('@modelcontextprotocol/sdk/client/index.js')
  let dir = dirname(entry)
  while (dir !== dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (pkg.name === '@modelcontextprotocol/sdk') return join(dir, 'package.json')
    } catch {
      // keep walking up
    }
    dir = dirname(dir)
  }
  throw new Error(`could not locate ${spec}`)
}

const cmp = (a: string, b: string) => {
  const [x, y] = [a, b].map(v => v.split('-')[0].split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

describe('SDK transitive dependency floors', () => {
  it('uses an SDK release that includes the OAuth credential-leak fix', () => {
    const pkg = JSON.parse(readFileSync(require_resolve('sdk'), 'utf8'))
    expect(cmp(pkg.version, '1.31.0')).toBeGreaterThanOrEqual(0)
  })

  it.each(Object.entries(floors))('%s resolves to >= %s everywhere the SDK loads it', (name, floor) => {
    const versions = installedVersions(name)
    expect(versions.length, `${name} not resolvable from the SDK`).toBeGreaterThan(0)
    for (const version of versions) expect(cmp(version, floor), `${name}@${version}`).toBeGreaterThanOrEqual(0)
  })
})
