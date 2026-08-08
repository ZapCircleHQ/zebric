import { tool } from 'langchain'
import { z } from 'zod'
import type { ZebricApplicationContract } from './discovery-client.js'

type CredentialProvider = () => string | undefined | Promise<string | undefined>

interface OpenApiParameter {
  name: string
  in: 'path' | 'query'
  required?: boolean
  description?: string
  schema?: {
    type?: string
    enum?: unknown[]
    default?: unknown
  }
}

interface OpenApiOperation {
  operationId?: string
  description?: string
  parameters?: OpenApiParameter[]
}

export interface RuntimeToolFactoryOptions {
  applicationName: string
  credential?: CredentialProvider
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
  maxResponseBytes?: number
}

function parameterSchema(parameter: OpenApiParameter): z.ZodType {
  const schema = parameter.schema ?? {}
  let result: z.ZodType
  switch (schema.type) {
    case 'integer': result = z.number().int(); break
    case 'number': result = z.number(); break
    case 'boolean': result = z.boolean(); break
    default: result = z.string()
  }
  if (schema.enum?.length) {
    result = result.refine(value => schema.enum!.includes(value), {
      message: `Expected one of: ${schema.enum.join(', ')}`,
    })
  }
  if (schema.default !== undefined) result = result.default(schema.default)
  if (!parameter.required) result = result.optional()
  return parameter.description ? result.describe(parameter.description) : result
}

function safeToolName(applicationName: string, operationId: string): string {
  return `${applicationName}_${operationId}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function createRuntimeReadTools(
  contract: ZebricApplicationContract,
  options: RuntimeToolFactoryOptions
) {
  const fetcher = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxResponseBytes = options.maxResponseBytes ?? 1_000_000
  const tools = []

  for (const [path, pathItem] of Object.entries(contract.openapi.paths)) {
    const operation = (pathItem as Record<string, unknown>).get as OpenApiOperation | undefined
    if (!operation?.operationId) continue

    const parameters = operation.parameters ?? []
    const shape: Record<string, z.ZodType> = {}
    for (const parameter of parameters) {
      if (parameter.in === 'path' || parameter.in === 'query') {
        shape[parameter.name] = parameterSchema(parameter)
      }
    }

    tools.push(tool(
      async (input: Record<string, unknown>) => {
        let resolvedPath = path
        const url = new URL(path, contract.baseUrl)
        for (const parameter of parameters) {
          const value = input[parameter.name]
          if (value === undefined) continue
          if (parameter.in === 'path') {
            resolvedPath = resolvedPath.replace(`{${parameter.name}}`, encodeURIComponent(String(value)))
          } else if (parameter.in === 'query') {
            url.searchParams.set(parameter.name, String(value))
          }
        }
        url.pathname = new URL(resolvedPath, contract.baseUrl).pathname
        if (url.origin !== new URL(contract.baseUrl).origin) {
          throw new Error('Runtime tool target must remain on the discovered application origin')
        }

        const credential = await options.credential?.()
        const response = await fetcher(url, {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            accept: 'application/json',
            ...(credential ? { authorization: `Bearer ${credential}` } : {}),
          },
        })
        const contentLength = Number(response.headers.get('content-length') ?? 0)
        if (contentLength > maxResponseBytes) throw new Error('Zebric API response exceeds the configured size limit')
        const body = await response.text()
        if (new TextEncoder().encode(body).byteLength > maxResponseBytes) {
          throw new Error('Zebric API response exceeds the configured size limit')
        }
        if (!response.ok) throw new Error(`Zebric API request failed with HTTP ${response.status}`)
        return body
      },
      {
        name: safeToolName(options.applicationName, operation.operationId),
        description: operation.description ?? `Read ${path} from ${options.applicationName}.`,
        schema: z.object(shape),
      }
    ))
  }

  return tools
}
