import { z } from 'zod'

const DiscoverySchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  openapi: z.string(),
  skills: z.array(z.string()).optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
})

const OpenApiSchema = z.object({
  openapi: z.string(),
  info: z.object({ title: z.string(), version: z.string() }),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
})

export interface ZebricApplicationContract {
  baseUrl: string
  discoveryUrl?: string
  openApiUrl: string
  discovery?: z.infer<typeof DiscoverySchema>
  openapi: z.infer<typeof OpenApiSchema>
}

export interface DiscoverApplicationOptions {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

async function fetchJson(
  fetcher: typeof globalThis.fetch,
  url: URL,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data?: unknown }> {
  const response = await fetcher(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  return {
    ok: response.ok,
    status: response.status,
    data: response.ok ? await response.json() : undefined,
  }
}

export async function discoverZebricApplication(
  baseUrl: string,
  options: DiscoverApplicationOptions = {}
): Promise<ZebricApplicationContract> {
  const base = new URL(baseUrl)
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('Zebric application URL must use http or https')
  }

  const fetcher = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 10_000
  const discoveryUrl = new URL('/.well-known/zebric-agent.json', base)
  const discoveryResponse = await fetchJson(fetcher, discoveryUrl, timeoutMs)

  let discovery: z.infer<typeof DiscoverySchema> | undefined
  let openApiUrl = new URL('/api/openapi.json', base)
  if (discoveryResponse.ok) {
    discovery = DiscoverySchema.parse(discoveryResponse.data)
    openApiUrl = new URL(discovery.openapi, base)
    if (openApiUrl.origin !== base.origin) {
      throw new Error('Cross-origin OpenAPI discovery is not allowed')
    }
  } else if (discoveryResponse.status !== 404) {
    throw new Error(`Zebric discovery failed with HTTP ${discoveryResponse.status}`)
  }

  const openApiResponse = await fetchJson(fetcher, openApiUrl, timeoutMs)
  if (!openApiResponse.ok) {
    throw new Error(`Zebric OpenAPI discovery failed with HTTP ${openApiResponse.status}`)
  }

  return {
    baseUrl: base.origin,
    ...(discovery ? { discovery, discoveryUrl: discoveryUrl.toString() } : {}),
    openApiUrl: openApiUrl.toString(),
    openapi: OpenApiSchema.parse(openApiResponse.data),
  }
}
