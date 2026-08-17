import { describe, expect, it, vi } from 'vitest'
import { discoverZebricApplication } from './discovery-client.js'

describe('discoverZebricApplication', () => {
  it('falls back to the OpenAPI endpoint when well-known discovery is unavailable', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/.well-known/zebric-agent.json')) {
        return new Response(null, { status: 404 })
      }
      return Response.json({
        openapi: '3.1.0',
        info: { title: 'Issue Board', version: '1.0.0' },
        paths: { '/api/agent/issues': { get: {} } },
      })
    }) as typeof fetch

    const result = await discoverZebricApplication('http://localhost:3000/board', { fetch: fetcher })

    expect(result.openApiUrl).toBe('http://localhost:3000/api/openapi.json')
    expect(result.openapi.info.title).toBe('Issue Board')
  })

  it('rejects a cross-origin OpenAPI document', async () => {
    const fetcher = vi.fn(async () => Response.json({
      name: 'Issue Board',
      openapi: 'https://attacker.example/openapi.json',
    })) as typeof fetch

    await expect(discoverZebricApplication('https://zebric.example', { fetch: fetcher }))
      .rejects.toThrow('Cross-origin OpenAPI discovery is not allowed')
  })

  it('requires the OpenAPI fingerprint to match discovery', async () => {
    const fingerprint = `sha256:${'a'.repeat(64)}`
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/.well-known/zebric-agent.json')) {
        return Response.json({
          name: 'Issue Board', openapi: '/api/openapi.json',
          contract: { version: '1', fingerprint },
        })
      }
      return Response.json({
        openapi: '3.1.0', info: { title: 'Issue Board', version: '1.0.0' }, paths: {},
        'x-zebric-contract': { version: '1', fingerprint: `sha256:${'b'.repeat(64)}` },
      })
    }) as typeof fetch

    await expect(discoverZebricApplication('https://zebric.example', { fetch: fetcher }))
      .rejects.toThrow('discovery and OpenAPI contract fingerprints do not match')
  })

  it('accepts a matching versioned contract fingerprint', async () => {
    const fingerprint = `sha256:${'c'.repeat(64)}`
    const fetcher = vi.fn(async (input: string | URL | Request) => Response.json(
      String(input).endsWith('/.well-known/zebric-agent.json')
        ? { name: 'Issue Board', openapi: '/api/openapi.json', contract: { version: '1', fingerprint } }
        : {
            openapi: '3.1.0', info: { title: 'Issue Board', version: '1.0.0' }, paths: {},
            'x-zebric-contract': { version: '1', fingerprint },
          }
    )) as typeof fetch

    const result = await discoverZebricApplication('https://zebric.example', { fetch: fetcher })
    expect(result.discovery?.contract).toEqual({ version: '1', fingerprint })
  })
})
