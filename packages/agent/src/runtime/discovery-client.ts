import { z } from 'zod'

const DiscoverySchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  openapi: z.string(),
  skills: z.array(z.string()).optional(),
  capabilities: z.record(z.string(), z.boolean()).optional(),
  contract: z.object({
    version: z.literal('1'),
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).optional(),
})

const OpenApiSchema = z.object({
  openapi: z.string(),
  info: z.object({ title: z.string(), version: z.string() }),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
  'x-zebric-contract': z.object({
    version: z.literal('1'),
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }).optional(),
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
  const openapi = OpenApiSchema.parse(openApiResponse.data)
  if (discovery?.contract && !openapi['x-zebric-contract']) {
    throw new Error('Zebric OpenAPI document is missing its advertised contract fingerprint')
  }
  if (discovery?.contract && openapi['x-zebric-contract']
    && (discovery.contract.version !== openapi['x-zebric-contract'].version
      || discovery.contract.fingerprint !== openapi['x-zebric-contract'].fingerprint)) {
    throw new Error('Zebric discovery and OpenAPI contract fingerprints do not match')
  }

  return {
    baseUrl: base.origin,
    ...(discovery ? { discovery, discoveryUrl: discoveryUrl.toString() } : {}),
    openApiUrl: openApiUrl.toString(),
    openapi,
  }
}
