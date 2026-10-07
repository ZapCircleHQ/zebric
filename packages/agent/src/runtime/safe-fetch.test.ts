import { describe, expect, it, vi } from 'vitest'
import { fetchWithoutRedirects } from './safe-fetch.js'
import { discoverZebricApplication } from './discovery-client.js'

describe('portable redirect refusal', () => {
  it.each([301, 302, 303, 307, 308])('refuses HTTP %s without following it', async status => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { status, headers: { location: 'https://evil.example/steal' } })
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe('manual')
      return response
    })
    await expect(fetchWithoutRedirects(fetcher, 'https://app.example/items', { headers: { authorization: 'Bearer secret' } })).rejects.toThrow(/redirects are not allowed/)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('uses a redirect mode accepted by workerd for discovery', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      // Model workerd's Request constructor rejecting unsupported redirect values.
      if (init?.redirect === 'error') throw new TypeError('Invalid redirect value')
      expect(init?.redirect).toBe('manual')
      return Response.json(String(input).endsWith('/.well-known/zebric-agent.json')
        ? { name: 'App', openapi: '/openapi.json' }
        : { openapi: '3.1.0', info: { title: 'App', version: '1' }, paths: {} })
    })
    await expect(discoverZebricApplication('https://app.example', { fetch: fetcher })).resolves.toMatchObject({ baseUrl: 'https://app.example' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects a custom fetch implementation returning a different origin', async () => {
    const response = Response.json({})
    Object.defineProperty(response, 'url', { value: 'https://evil.example/items' })
    await expect(fetchWithoutRedirects(async () => response, 'https://app.example/items')).rejects.toThrow(/off the application origin/)
  })
})
