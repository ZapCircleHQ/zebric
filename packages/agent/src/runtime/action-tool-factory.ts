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
    type?: string | string[]
    enum?: unknown[]
    default?: unknown
  }
}

interface OpenApiOperation {
  operationId?: string
  description?: string
  parameters?: OpenApiParameter[]
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: {
          properties?: Record<string, { type?: string | string[]; enum?: unknown[] }>
          required?: string[]
        }
      }
    }
  }
}

export interface MutationApprovalRequest {
  application: string
  operationId: string
  method: string
  path: string
  input: Record<string, unknown>
}

export interface RuntimeToolFactoryOptions {
  applicationName: string
  credential?: CredentialProvider
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
  maxResponseBytes?: number
  mutations?: {
    approve(request: MutationApprovalRequest): boolean | Promise<boolean>
    idempotencyKey(operationId: string, input: Record<string, unknown>): string
    observeJobs?: boolean
    pollIntervalMs?: number
    maxPolls?: number
    agentRunId?: () => string
  }
}

function parameterSchema(parameter: OpenApiParameter): z.ZodType {
  const schema = parameter.schema ?? {}
  let result: z.ZodType
  if (Array.isArray(schema.type) && schema.type.includes('object') && schema.type.includes('array')) {
    result = z.json()
  } else {
  switch (schema.type) {
    case 'integer': result = z.number().int(); break
    case 'number': result = z.number(); break
    case 'boolean': result = z.boolean(); break
    default: result = z.string()
  }
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
    const methods = options.mutations ? ['get', 'post', 'put', 'delete'] : ['get']
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenApiOperation | undefined
      if (!operation?.operationId) continue
      const isMutation = method !== 'get'

      const parameters = operation.parameters ?? []
      const shape: Record<string, z.ZodType> = {}
      for (const parameter of parameters) {
        if (parameter.in === 'path' || parameter.in === 'query') {
          shape[parameter.name] = parameterSchema(parameter)
        }
      }
      const bodyProperties = operation.requestBody?.content?.['application/json']?.schema?.properties ?? {}
      const requiredBody = new Set(operation.requestBody?.content?.['application/json']?.schema?.required ?? [])
      for (const [name, schema] of Object.entries(bodyProperties)) {
        shape[name] = parameterSchema({ name, in: 'query', schema, required: requiredBody.has(name) })
      }

      tools.push(tool(
        async (input: Record<string, unknown>) => {
        if (isMutation) {
          const approved = await options.mutations!.approve({
            application: options.applicationName,
            operationId: operation.operationId!,
            method: method.toUpperCase(),
            path,
            input,
          })
          if (!approved) throw new Error('Zebric mutation was not approved')
        }
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
        const requestBody = isMutation
          ? Object.fromEntries(Object.keys(bodyProperties).filter(name => input[name] !== undefined).map(name => [name, input[name]]))
          : undefined
        const response = await fetcher(url, {
          method: method.toUpperCase(),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            accept: 'application/json',
            ...(isMutation ? {
              'content-type': 'application/json',
              'idempotency-key': options.mutations!.idempotencyKey(operation.operationId!, input),
              ...(options.mutations!.agentRunId ? { 'x-agent-run-id': options.mutations!.agentRunId() } : {}),
            } : {}),
            ...(credential ? { authorization: `Bearer ${credential}` } : {}),
          },
          ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
        })
        const contentLength = Number(response.headers.get('content-length') ?? 0)
        if (contentLength > maxResponseBytes) throw new Error('Zebric API response exceeds the configured size limit')
        const responseBody = await response.text()
        if (new TextEncoder().encode(responseBody).byteLength > maxResponseBytes) {
          throw new Error('Zebric API response exceeds the configured size limit')
        }
        if (!response.ok) throw new Error(`Zebric API request failed with HTTP ${response.status}`)
        if (response.status === 202 && options.mutations?.observeJobs !== false) {
          const accepted = JSON.parse(responseBody)
          const jobUrl = new URL(accepted.job?.url || response.headers.get('location'), contract.baseUrl)
          return observeJob(fetcher, jobUrl, contract.baseUrl, credential, options)
        }
        return responseBody
      },
      {
        name: safeToolName(options.applicationName, operation.operationId),
        description: operation.description ?? `Read ${path} from ${options.applicationName}.`,
        schema: z.object(shape),
      }
      ))
    }
  }

  return tools
}

async function observeJob(
  fetcher: typeof globalThis.fetch,
  jobUrl: URL,
  baseUrl: string,
  credential: string | undefined,
  options: RuntimeToolFactoryOptions
): Promise<string> {
  if (jobUrl.origin !== new URL(baseUrl).origin) {
    throw new Error('Workflow job URL must remain on the application origin')
  }
  const maxPolls = options.mutations?.maxPolls ?? 100
  const pollIntervalMs = options.mutations?.pollIntervalMs ?? 25
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const response = await fetcher(jobUrl, {
      headers: { accept: 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`Workflow job request failed with HTTP ${response.status}`)
    const body = await response.text()
    const job = JSON.parse(body)
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return body
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
  }
  throw new Error('Timed out waiting for Zebric workflow job')
}
