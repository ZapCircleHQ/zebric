import { tool } from 'langchain'
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
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

export interface RuntimeMutationOptions {
  approve(request: MutationApprovalRequest): boolean | Promise<boolean>
  idempotencyKey?(operationId: string, input: Record<string, unknown>): string
  observeJobs?: boolean
  pollIntervalMs?: number
  maxPolls?: number
  agentRunId?: () => string
  state?: MutationExecutionStateStore
  stateContext?: () => string | undefined
}

export interface MutationExecutionState {
  idempotencyKey: string
  jobUrl?: string
}

export interface MutationExecutionStateStore {
  get(key: string): MutationExecutionState | undefined | Promise<MutationExecutionState | undefined>
  set(key: string, value: MutationExecutionState): void | Promise<void>
  delete(key: string): void | Promise<void>
}

export class InMemoryMutationExecutionStateStore implements MutationExecutionStateStore {
  private readonly entries = new Map<string, MutationExecutionState>()
  get(key: string) { return this.entries.get(key) }
  set(key: string, value: MutationExecutionState) { this.entries.set(key, value) }
  delete(key: string) { this.entries.delete(key) }
}

export type ZebricApiErrorKind = 'authentication' | 'authorization' | 'validation' | 'not_found' | 'conflict' | 'rate_limit' | 'server' | 'http'

export class ZebricApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | undefined,
    readonly kind: ZebricApiErrorKind,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'ZebricApiError'
  }
}

export interface RuntimeToolFactoryOptions {
  applicationName: string
  credential?: CredentialProvider
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
  maxResponseBytes?: number
  mutations?: RuntimeMutationOptions
  correlationId?: () => string | undefined
}

export interface RuntimeToolMetadata {
  application: string
  operationId: string
  method: string
  path: string
  risk: 'read' | 'write'
}

const runtimeToolMetadata = new WeakMap<object, RuntimeToolMetadata>()

export function getRuntimeToolMetadata(runtimeTool: object): RuntimeToolMetadata | undefined {
  return runtimeToolMetadata.get(runtimeTool)
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

      const generatedTool = tool(
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
        const correlationId = options.correlationId?.()
        const stateKey = isMutation ? mutationStateKey(options, operation.operationId!, method, path, input) : undefined
        const priorState = stateKey ? await options.mutations?.state?.get(stateKey) : undefined
        if (priorState?.jobUrl) {
          const output = await observeJob(fetcher, new URL(priorState.jobUrl), contract.baseUrl, credential, options)
          await options.mutations?.state?.delete(stateKey!)
          return output
        }
        const idempotencyKey = isMutation
          ? priorState?.idempotencyKey
            ?? options.mutations!.idempotencyKey?.(operation.operationId!, input)
            ?? randomUUID()
          : undefined
        if (stateKey && idempotencyKey && !priorState) {
          await options.mutations?.state?.set(stateKey, { idempotencyKey })
        }
        const requestBody = isMutation
          ? Object.fromEntries(Object.keys(bodyProperties).filter(name => input[name] !== undefined).map(name => [name, input[name]]))
          : undefined
        const response = await fetcher(url, {
          method: method.toUpperCase(),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            accept: 'application/json',
            ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
            ...(isMutation ? {
              'content-type': 'application/json',
              'idempotency-key': idempotencyKey!,
              ...(options.mutations!.agentRunId ? { 'x-agent-run-id': options.mutations!.agentRunId() } : {}),
            } : {}),
            ...(credential ? { authorization: `Bearer ${credential}` } : {}),
          },
          ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
        })
        const contentLength = Number(response.headers.get('content-length') ?? 0)
        if (contentLength > maxResponseBytes) throw new Error('Zebric API response exceeds the configured size limit')
        const responseBody = redactSensitiveText(await response.text(), credential)
        if (new TextEncoder().encode(responseBody).byteLength > maxResponseBytes) {
          throw new Error('Zebric API response exceeds the configured size limit')
        }
        if (!response.ok) {
          if (stateKey && response.status < 500 && response.status !== 429) {
            await options.mutations?.state?.delete(stateKey)
          }
          throw parseApiError(response, responseBody)
        }
        if (response.status === 202 && options.mutations?.observeJobs !== false) {
          const accepted = JSON.parse(responseBody)
          const jobUrl = new URL(accepted.job?.url || response.headers.get('location'), contract.baseUrl)
          if (stateKey) await options.mutations?.state?.set(stateKey, { idempotencyKey: idempotencyKey!, jobUrl: jobUrl.toString() })
          const output = await observeJob(fetcher, jobUrl, contract.baseUrl, credential, options)
          if (stateKey) await options.mutations?.state?.delete(stateKey)
          return output
        }
        if (stateKey) await options.mutations?.state?.delete(stateKey)
        return responseBody
      },
      {
        name: safeToolName(options.applicationName, operation.operationId),
        description: operation.description ?? `Read ${path} from ${options.applicationName}.`,
        schema: z.object(shape),
      }
      )
      runtimeToolMetadata.set(generatedTool, {
        application: options.applicationName,
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        risk: isMutation ? 'write' : 'read',
      })
      tools.push(generatedTool)
    }
  }

  const names = new Set<string>()
  for (const generatedTool of tools) {
    if (names.has(generatedTool.name)) {
      throw new Error(`Zebric tool-name collision: ${generatedTool.name}`)
    }
    names.add(generatedTool.name)
  }
  return tools
}

function parseApiError(response: Response, body: string): ZebricApiError {
  let envelope: { error?: { message?: unknown; code?: unknown; requestId?: unknown } } = {}
  try {
    envelope = JSON.parse(body)
  } catch {
    // Unstructured upstream bodies are intentionally not reflected to the model.
  }
  const status = response.status
  const kind: ZebricApiErrorKind = status === 401 ? 'authentication'
    : status === 403 ? 'authorization'
      : status === 400 || status === 422 ? 'validation'
        : status === 404 ? 'not_found'
          : status === 409 ? 'conflict'
            : status === 429 ? 'rate_limit'
              : status >= 500 ? 'server'
                : 'http'
  const message = typeof envelope.error?.message === 'string'
    ? envelope.error.message
    : `Zebric API request failed with HTTP ${status}`
  const code = typeof envelope.error?.code === 'string' ? envelope.error.code : `HTTP_${status}`
  const requestId = typeof envelope.error?.requestId === 'string'
    ? envelope.error.requestId
    : response.headers.get('x-request-id') ?? undefined
  return new ZebricApiError(message, status, code, requestId, kind, status === 429 || status >= 500)
}

function mutationStateKey(
  options: RuntimeToolFactoryOptions,
  operationId: string,
  method: string,
  path: string,
  input: Record<string, unknown>
): string | undefined {
  const context = options.mutations?.stateContext?.()
  if (!context || !options.mutations?.state) return undefined
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([method.toUpperCase(), path, operationId, stableValue(input)]))
    .digest('hex')
  return `${context}:${options.applicationName}:${fingerprint}`
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]))
  }
  return value
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
    const correlationId = options.correlationId?.()
    const response = await fetcher(jobUrl, {
      headers: {
        accept: 'application/json',
        ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
    const maxResponseBytes = options.maxResponseBytes ?? 1_000_000
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > maxResponseBytes) throw new Error('Zebric API response exceeds the configured size limit')
    const body = redactSensitiveText(await response.text(), credential)
    if (new TextEncoder().encode(body).byteLength > maxResponseBytes) {
      throw new Error('Zebric API response exceeds the configured size limit')
    }
    if (!response.ok) throw parseApiError(response, body)
    const job = JSON.parse(body)
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return body
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
  }
  throw new Error('Timed out waiting for Zebric workflow job')
}

function redactSensitiveText(value: string, credential: string | undefined): string {
  if (!credential) return value
  return value.split(credential).join('[REDACTED]')
}
