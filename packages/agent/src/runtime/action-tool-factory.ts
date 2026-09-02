import { tool } from 'langchain'
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import type { ZebricApplicationContract } from './discovery-client.js'

type CredentialProvider = () => string | undefined | Promise<string | undefined>

interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: OpenApiInputSchema
}

type OpenApiInputSchema = Record<string, unknown>
type OpenApiObjectSchema = Record<string, unknown> & {
  type?: unknown
  properties?: Record<string, OpenApiInputSchema>
  required?: unknown
}

interface OpenApiOperation {
  operationId?: string
  description?: string
  parameters?: OpenApiParameter[]
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: {
          type?: unknown
          properties?: Record<string, OpenApiInputSchema>
          required?: string[]
          [key: string]: unknown
        }
      }
    }
  }
  'x-zebric-agent-operation'?: {
    risk?: unknown
    approvalRequired?: unknown
    idempotencyRequired?: unknown
    asynchronous?: unknown
    requiredScopes?: unknown
    workflow?: unknown
    preconditions?: unknown
  }
  'x-zebric-required-scopes'?: unknown
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
    readonly retryable: boolean,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ZebricApiError'
  }
}

export class UnsupportedOpenApiSchemaError extends Error {
  constructor(
    readonly application: string,
    readonly operationId: string,
    readonly schemaPath: string,
    reason: string
  ) {
    super(`Unsupported OpenAPI schema for application "${application}", operation "${operationId}", at ${schemaPath}: ${reason}`)
    this.name = 'UnsupportedOpenApiSchemaError'
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
  retry?: false | {
    /** Total attempts including the initial request. Defaults to 3. */
    maxAttempts?: number
    /** Initial exponential-backoff delay. Defaults to 250ms. */
    baseDelayMs?: number
    /** Maximum backoff delay. Defaults to 5s. */
    maxDelayMs?: number
    /** Injectable timer for deterministic tests. */
    sleep?: (delayMs: number) => Promise<void>
  }
}

export interface RuntimeToolMetadata {
  application: string
  operationId: string
  method: string
  path: string
  risk: 'read' | 'write' | 'destructive' | 'external'
  approvalRequired: boolean
  idempotencyRequired: boolean
  asynchronous: boolean
  requiredScopes: string[]
  workflow?: string
  preconditions?: Record<string, unknown>
}

const runtimeToolMetadata = new WeakMap<object, RuntimeToolMetadata>()

export function getRuntimeToolMetadata(runtimeTool: object): RuntimeToolMetadata | undefined {
  return runtimeToolMetadata.get(runtimeTool)
}

function parameterSchema(
  parameter: OpenApiParameter,
  context: { application: string; operationId: string; schemaPath: string }
): z.ZodType {
  const schema = parameter.schema
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    unsupported(context, 'a schema object is required')
  }
  rejectUnsupportedKeywords(schema, context)
  const type = schema.type
  let result: z.ZodType
  if (Array.isArray(type)) {
    if (type.length === 2 && type.includes('object') && type.includes('array')) {
      result = z.union([z.record(z.string(), z.json()), z.array(z.json())])
    } else {
      unsupported(context, `type unions are not supported (${JSON.stringify(type)})`)
    }
  } else {
    switch (type) {
      case 'integer': result = numericSchema(schema, true, context); break
      case 'number': result = numericSchema(schema, false, context); break
      case 'boolean': result = z.boolean(); break
      case 'string': result = stringSchema(schema, context); break
      default: unsupported(context, `type must be one of string, integer, number, boolean, or the Zebric JSON union; received ${JSON.stringify(type)}`)
    }
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) unsupported(context, 'enum must be a non-empty array')
    result = result.refine(value => (schema.enum as unknown[]).includes(value), {
      message: `Expected one of: ${(schema.enum as unknown[]).join(', ')}`,
    })
  }
  if (schema.default !== undefined) result = result.default(schema.default)
  if (!parameter.required) result = result.optional()
  return parameter.description ? result.describe(parameter.description) : result
}

const COMMON_SCHEMA_KEYWORDS = new Set(['type', 'enum', 'default', 'description'])

function rejectUnsupportedKeywords(
  schema: OpenApiInputSchema,
  context: { application: string; operationId: string; schemaPath: string }
): void {
  const typeSpecific = schema.type === 'string'
    ? ['format', 'minLength', 'maxLength', 'pattern']
    : schema.type === 'number' || schema.type === 'integer'
      ? ['minimum', 'maximum']
      : []
  const supported = new Set([...COMMON_SCHEMA_KEYWORDS, ...typeSpecific])
  const unsupportedKeyword = Object.keys(schema).find(key => !supported.has(key))
  if (unsupportedKeyword) unsupported(context, `keyword "${unsupportedKeyword}" is not supported`)
}

function numericSchema(
  schema: OpenApiInputSchema,
  integer: boolean,
  context: { application: string; operationId: string; schemaPath: string }
): z.ZodType {
  let result = integer ? z.number().int() : z.number()
  if (schema.minimum !== undefined) {
    if (typeof schema.minimum !== 'number') unsupported(context, 'minimum must be a number')
    result = result.min(schema.minimum)
  }
  if (schema.maximum !== undefined) {
    if (typeof schema.maximum !== 'number') unsupported(context, 'maximum must be a number')
    result = result.max(schema.maximum)
  }
  return result
}

function stringSchema(
  schema: OpenApiInputSchema,
  context: { application: string; operationId: string; schemaPath: string }
): z.ZodType {
  let result = z.string()
  if (schema.minLength !== undefined) {
    if (!Number.isInteger(schema.minLength) || (schema.minLength as number) < 0) unsupported(context, 'minLength must be a non-negative integer')
    result = result.min(schema.minLength as number)
  }
  if (schema.maxLength !== undefined) {
    if (!Number.isInteger(schema.maxLength) || (schema.maxLength as number) < 0) unsupported(context, 'maxLength must be a non-negative integer')
    result = result.max(schema.maxLength as number)
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') unsupported(context, 'pattern must be a string')
    try {
      result = result.regex(new RegExp(schema.pattern))
    } catch {
      unsupported(context, 'pattern must be a valid regular expression')
    }
  }
  if (schema.format !== undefined) {
    let formatValidator: z.ZodType
    switch (schema.format) {
      case 'email': formatValidator = z.email(); break
      case 'uuid': formatValidator = z.uuid(); break
      case 'date': formatValidator = z.iso.date(); break
      case 'date-time': formatValidator = z.iso.datetime({ offset: true }); break
      default: unsupported(context, `format "${String(schema.format)}" is not supported`)
    }
    result = result.refine(value => formatValidator.safeParse(value).success, {
      message: `Expected string format: ${String(schema.format)}`,
    }) as typeof result
  }
  return result
}

function unsupported(
  context: { application: string; operationId: string; schemaPath: string },
  reason: string
): never {
  throw new UnsupportedOpenApiSchemaError(context.application, context.operationId, context.schemaPath, reason)
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
  const maxResponseBytes = options.maxResponseBytes ?? 1_000_000
  const tools = []

  for (const [path, pathItem] of Object.entries(contract.openapi.paths)) {
    if (Array.isArray((pathItem as Record<string, unknown>).parameters) && ((pathItem as Record<string, unknown>).parameters as unknown[]).length > 0) {
      throw new Error(`Unsupported OpenAPI contract for application "${options.applicationName}" at paths.${path}.parameters: path-level parameters are not supported`)
    }
    const methods = options.mutations ? ['get', 'post', 'put', 'delete'] : ['get']
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenApiOperation | undefined
      if (!operation?.operationId) continue
      const isMutation = method !== 'get'
      const agentMetadata = parseAgentOperationMetadata(operation, options.applicationName, method)

      const parameters = operation.parameters ?? []
      if (!Array.isArray(parameters)) {
        unsupported({
          application: options.applicationName,
          operationId: operation.operationId,
          schemaPath: `paths.${path}.${method}.parameters`,
        }, 'parameters must be an array')
      }
      const shape: Record<string, z.ZodType> = {}
      for (const [index, parameter] of parameters.entries()) {
        validateParameter(parameter, options.applicationName, operation.operationId, path, method, index)
        if (parameter.in === 'path' || parameter.in === 'query') {
          shape[parameter.name] = parameterSchema(parameter, {
            application: options.applicationName,
            operationId: operation.operationId,
            schemaPath: `paths.${path}.${method}.parameters[${index}].schema`,
          })
        } else if (parameter.in === 'header') {
          if (!['idempotency-key', 'x-agent-run-id'].includes(parameter.name.toLowerCase())) {
            unsupported({
              application: options.applicationName,
              operationId: operation.operationId,
              schemaPath: `paths.${path}.${method}.parameters[${index}]`,
            }, `model-supplied header parameter "${parameter.name}" is not supported`)
          }
        } else {
          unsupported({
            application: options.applicationName,
            operationId: operation.operationId,
            schemaPath: `paths.${path}.${method}.parameters[${index}]`,
          }, `parameter location "${parameter.in}" is not supported`)
        }
      }
      const bodySchema = operation.requestBody
        ? validateRequestBody(operation.requestBody, contract.openapi, options.applicationName, operation.operationId, path, method)
        : undefined
      const bodyProperties = bodySchema?.properties ?? {}
      const requiredBody = new Set(bodySchema?.required ?? [])
      for (const [name, schema] of Object.entries(bodyProperties)) {
        shape[name] = parameterSchema(
          { name, in: 'query', schema, required: requiredBody.has(name) },
          {
            application: options.applicationName,
            operationId: operation.operationId,
            schemaPath: `paths.${path}.${method}.requestBody.content.application/json.schema.properties.${name}`,
          }
        )
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
        const requestInit: RequestInit = {
          method: method.toUpperCase(),
          redirect: 'error',
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
        }
        const response = await fetchWithRetry(fetcher, url, requestInit, options, !isMutation || Boolean(idempotencyKey))
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
        ...agentMetadata,
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

function parseAgentOperationMetadata(
  operation: OpenApiOperation,
  application: string,
  method: string
): Pick<RuntimeToolMetadata, 'risk' | 'approvalRequired' | 'idempotencyRequired' | 'asynchronous' | 'requiredScopes' | 'workflow' | 'preconditions'> {
  const declared = operation['x-zebric-agent-operation']
  const fallbackRisk = method === 'get' ? 'read' : method === 'delete' ? 'destructive' : 'write'
  const legacyScopes = operation['x-zebric-required-scopes']
  if (legacyScopes !== undefined
    && (!Array.isArray(legacyScopes) || legacyScopes.some(scope => typeof scope !== 'string'))) {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", operation ${operation.operationId}: x-zebric-required-scopes must be strings`)
  }
  if (!declared) {
    return {
      risk: fallbackRisk,
      approvalRequired: method !== 'get',
      idempotencyRequired: method !== 'get',
      asynchronous: false,
      requiredScopes: (legacyScopes as string[] | undefined) ?? [],
    }
  }
  const schemaPath = `paths operation ${operation.operationId}.x-zebric-agent-operation`
  if (!['read', 'write', 'destructive', 'external'].includes(String(declared.risk))) {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: unsupported risk`)
  }
  for (const key of ['approvalRequired', 'idempotencyRequired', 'asynchronous'] as const) {
    if (typeof declared[key] !== 'boolean') {
      throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: ${key} must be boolean`)
    }
  }
  if (declared.requiredScopes !== undefined
    && (!Array.isArray(declared.requiredScopes) || declared.requiredScopes.some(scope => typeof scope !== 'string'))) {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: requiredScopes must be strings`)
  }
  if (declared.workflow !== undefined && typeof declared.workflow !== 'string') {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: workflow must be a string`)
  }
  if (declared.preconditions !== undefined
    && (!declared.preconditions || typeof declared.preconditions !== 'object' || Array.isArray(declared.preconditions))) {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: preconditions must be an object`)
  }
  if (method === 'get' && declared.risk !== 'read') {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: GET operations must be read risk`)
  }
  if (method !== 'get' && declared.approvalRequired !== true) {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: mutations must require approval`)
  }
  if (declared.approvalRequired !== (declared.risk !== 'read')) {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: risk and approvalRequired disagree`)
  }
  if (declared.idempotencyRequired !== (method !== 'get')) {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: idempotencyRequired contradicts the HTTP method`)
  }
  if (declared.asynchronous === true && typeof declared.workflow !== 'string') {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: asynchronous operations must identify a workflow`)
  }
  const requiredScopes = (declared.requiredScopes as string[] | undefined) ?? []
  if (Array.isArray(legacyScopes)
    && JSON.stringify([...legacyScopes].sort()) !== JSON.stringify([...requiredScopes].sort())) {
    throw new Error(`Invalid Zebric agent metadata for application "${application}", ${schemaPath}: required scope metadata does not match`)
  }
  return {
    risk: declared.risk as RuntimeToolMetadata['risk'],
    approvalRequired: declared.approvalRequired as boolean,
    idempotencyRequired: declared.idempotencyRequired as boolean,
    asynchronous: declared.asynchronous as boolean,
    requiredScopes,
    ...(declared.workflow ? { workflow: declared.workflow } : {}),
    ...(declared.preconditions ? { preconditions: declared.preconditions as Record<string, unknown> } : {}),
  }
}

function validateParameter(
  parameter: OpenApiParameter,
  application: string,
  operationId: string,
  path: string,
  method: string,
  index: number
): void {
  const schemaPath = `paths.${path}.${method}.parameters[${index}]`
  const context = { application, operationId, schemaPath }
  if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) unsupported(context, 'parameter must be an object')
  const supportedKeys = new Set(['name', 'in', 'required', 'description', 'schema'])
  const unsupportedKeyword = Object.keys(parameter).find(key => !supportedKeys.has(key))
  if (unsupportedKeyword) unsupported(context, `parameter keyword "${unsupportedKeyword}" is not supported`)
  if (typeof parameter.name !== 'string' || !parameter.name) unsupported(context, 'parameter name must be a non-empty string')
  if (!['path', 'query', 'header', 'cookie'].includes(parameter.in)) unsupported(context, `parameter location "${String(parameter.in)}" is not supported`)
  if (parameter.required !== undefined && typeof parameter.required !== 'boolean') unsupported(context, 'parameter required must be boolean')
  if (parameter.in === 'path' && parameter.required !== true) unsupported(context, 'path parameters must be required')
}

function validateRequestBody(
  requestBody: NonNullable<OpenApiOperation['requestBody']>,
  openapi: ZebricApplicationContract['openapi'],
  application: string,
  operationId: string,
  path: string,
  method: string
): { properties: Record<string, OpenApiInputSchema>; required?: string[] } {
  const schemaPath = `paths.${path}.${method}.requestBody.content.application/json.schema`
  const requestBodyKeys = new Set(['required', 'description', 'content'])
  const unsupportedRequestBodyKey = Object.keys(requestBody).find(key => !requestBodyKeys.has(key))
  if (unsupportedRequestBodyKey) unsupported({ application, operationId, schemaPath }, `request body keyword "${unsupportedRequestBodyKey}" is not supported`)
  const mediaTypes = Object.keys(requestBody.content ?? {})
  if (mediaTypes.length !== 1 || mediaTypes[0] !== 'application/json') {
    unsupported({ application, operationId, schemaPath }, 'only a single application/json media type is supported')
  }
  const declaredSchema = requestBody.content?.['application/json']?.schema
  const context = { application, operationId, schemaPath }
  if (!declaredSchema) unsupported(context, 'an application/json request body schema is required')
  const schema = resolveLocalSchema(declaredSchema, openapi, context)
  const supportedKeys = new Set(['type', 'properties', 'required', 'description'])
  const unsupportedKeyword = Object.keys(schema).find(key => !supportedKeys.has(key))
  if (unsupportedKeyword) unsupported(context, `keyword "${unsupportedKeyword}" is not supported`)
  if (schema.type !== 'object') unsupported(context, 'request body schema type must be "object"')
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    unsupported(context, 'request body properties must be an object')
  }
  const declaredRequired = schema.required as unknown
  if (declaredRequired !== undefined && (!Array.isArray(declaredRequired) || declaredRequired.some(name => typeof name !== 'string'))) {
    unsupported(context, 'required must be an array of property names')
  }
  const required = declaredRequired as string[] | undefined
  const propertyNames = new Set(Object.keys(schema.properties))
  const unknownRequired = required?.find(name => !propertyNames.has(name))
  if (unknownRequired) unsupported(context, `required property "${unknownRequired}" is not declared`)
  return { properties: schema.properties, ...(required ? { required } : {}) }
}

function resolveLocalSchema(
  schema: Record<string, unknown>,
  openapi: ZebricApplicationContract['openapi'],
  context: { application: string; operationId: string; schemaPath: string },
): OpenApiObjectSchema {
  if (!('$ref' in schema)) return schema as OpenApiObjectSchema
  if (Object.keys(schema).length !== 1 || typeof schema.$ref !== 'string') {
    unsupported(context, 'a schema reference cannot have sibling keywords')
  }
  const prefix = '#/components/schemas/'
  if (!schema.$ref.startsWith(prefix)) unsupported(context, 'only local component schema references are supported')
  const encodedName = schema.$ref.slice(prefix.length)
  if (!encodedName || encodedName.includes('/')) unsupported(context, 'component schema reference is invalid')
  const name = encodedName.replace(/~1/g, '/').replace(/~0/g, '~')
  const resolved = openapi.components?.schemas[name]
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    unsupported(context, `component schema "${name}" was not found`)
  }
  if ('$ref' in resolved) unsupported(context, 'nested schema references are not supported')
  return resolved as OpenApiObjectSchema
}

function parseApiError(response: Response, body: string): ZebricApiError {
  let envelope: { error?: { message?: unknown; code?: unknown; requestId?: unknown; retryable?: unknown; details?: unknown } } = {}
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
  const retryable = typeof envelope.error?.retryable === 'boolean'
    ? envelope.error.retryable
    : status === 429 || status >= 500
  const details = envelope.error?.details && typeof envelope.error.details === 'object' && !Array.isArray(envelope.error.details)
    ? envelope.error.details as Record<string, unknown>
    : undefined
  return new ZebricApiError(message, status, code, requestId, kind, retryable, details)
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
    const response = await fetchWithRetry(fetcher, jobUrl, {
      headers: {
        accept: 'application/json',
        ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      redirect: 'error',
    }, options, true)
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

async function fetchWithRetry(
  fetcher: typeof globalThis.fetch,
  input: URL,
  init: RequestInit,
  options: RuntimeToolFactoryOptions,
  safeToRetry: boolean
): Promise<Response> {
  const retry = resolveRetryPolicy(options.retry)
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
    const response = await fetcher(input, {
      ...init,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
    if (!safeToRetry || attempt === retry.maxAttempts || !await explicitlyRetryable(response)) return response
    const delayMs = retryAfterDelay(response.headers.get('retry-after'))
      ?? Math.min(retry.maxDelayMs, retry.baseDelayMs * (2 ** (attempt - 1)))
    response.body?.cancel().catch(() => {})
    await retry.sleep(delayMs)
  }
  throw new Error('Unreachable retry state')
}

function resolveRetryPolicy(retry: RuntimeToolFactoryOptions['retry']): {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  sleep(delayMs: number): Promise<void>
} {
  if (retry === false) return { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, sleep: async () => {} }
  const maxAttempts = retry?.maxAttempts ?? 3
  const baseDelayMs = retry?.baseDelayMs ?? 250
  const maxDelayMs = retry?.maxDelayMs ?? 5_000
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError('Retry maxAttempts must be a positive integer')
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) throw new TypeError('Retry baseDelayMs must be non-negative')
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) throw new TypeError('Retry maxDelayMs must be non-negative')
  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    sleep: retry?.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs))),
  }
}

async function explicitlyRetryable(response: Response): Promise<boolean> {
  if (response.ok) return false
  try {
    const body = await response.clone().json() as { error?: { retryable?: unknown } }
    return body.error?.retryable === true
  } catch {
    return false
  }
}

function retryAfterDelay(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - Date.now())
}

function redactSensitiveText(value: string, credential: string | undefined): string {
  if (!credential) return value
  return value.split(credential).join('[REDACTED]')
}
