import type { Actor } from '../auth/actor.js'
import {
  ExternalResultValidationError,
  ServiceFailureError,
  ValidationFailureError,
} from '../errors/domain-errors.js'
import type { ExecutionObserverPort } from '../routing/request-ports.js'
import type {
  ExternalValueSchema,
  ServiceConfig,
  ServiceOperation,
} from '../types/blueprint.js'

export interface ServiceInvocationContext {
  actor?: Actor
  correlationId?: string
  workflow?: string
  workflowContext?: Record<string, unknown>
}

export type ServiceHandler = (
  params: Record<string, unknown>,
  context: ServiceInvocationContext,
) => unknown | Promise<unknown>

export interface ServiceInvoker {
  invoke(
    service: string,
    operation: string,
    params?: Record<string, unknown>,
    context?: ServiceInvocationContext,
  ): Promise<unknown>
}

export type ServiceHandlerResolver = (
  service: ServiceConfig,
  operation: string,
) => ServiceHandler | undefined

export interface ServiceRegistryOptions {
  observer?: ExecutionObserverPort
  resolveHandler?: ServiceHandlerResolver
}

/**
 * Registry and execution boundary for outbound integrations.
 *
 * Implementations are registered by application code or resolved lazily from a
 * platform plugin. Blueprints contain schemas and operation names, never secrets.
 */
export class ServiceRegistry implements ServiceInvoker {
  private readonly definitions = new Map<string, ServiceConfig>()
  private readonly handlers = new Map<string, ServiceHandler>()
  private observer?: ExecutionObserverPort

  constructor(services: ServiceConfig[] = [], private readonly options: ServiceRegistryOptions = {}) {
    this.observer = options.observer
    for (const service of services) this.registerDefinition(service)
  }

  setObserver(observer: ExecutionObserverPort): void {
    this.observer = observer
  }

  registerDefinition(service: ServiceConfig): void {
    if (this.definitions.has(service.name)) {
      throw new ValidationFailureError(`Duplicate service definition: ${service.name}`, {
        service: service.name,
      })
    }
    this.definitions.set(service.name, service)
  }

  register(service: string, operation: string, handler: ServiceHandler): void {
    this.handlers.set(handlerKey(service, operation), handler)
  }

  get(name: string): ServiceConfig | undefined {
    return this.definitions.get(name)
  }

  list(): ServiceConfig[] {
    return [...this.definitions.values()]
  }

  async invoke(
    serviceName: string,
    operationName: string,
    params: Record<string, unknown> = {},
    context: ServiceInvocationContext = {},
  ): Promise<unknown> {
    const service = this.definitions.get(serviceName)
    if (!service) {
      throw new ServiceFailureError(`Unknown service: ${serviceName}`, { service: serviceName })
    }
    const operation = service.operations[operationName]
    if (!operation) {
      throw new ServiceFailureError(`Unknown service operation: ${serviceName}.${operationName}`, {
        service: serviceName,
        operation: operationName,
      })
    }

    validateServiceInput(serviceName, operationName, operation, params)
    const handler = this.handlers.get(handlerKey(serviceName, operationName))
      ?? this.options.resolveHandler?.(service, operationName)
    if (!handler) {
      throw new ServiceFailureError(`Service operation is not configured: ${serviceName}.${operationName}`, {
        service: serviceName,
        operation: operationName,
      })
    }

    const span = this.observer?.startSpan('zebric.service', {
      'zebric.service.name': serviceName,
      'zebric.service.operation': operationName,
    }, context.correlationId)
    try {
      const rawResult = await handler(params, context)
      if (operation.result) {
        validateExternalValue(rawResult, operation.result, 'result', serviceName, operationName)
      }
      const result = operation.transform
        ? transformExternalResult(operation.transform, rawResult, params)
        : rawResult
      this.observer?.endSpan(span)
      return result
    } catch (error) {
      this.observer?.endSpan(span, error)
      if (error instanceof ExternalResultValidationError || error instanceof ServiceFailureError) throw error
      throw new ServiceFailureError(
        `Service operation failed: ${serviceName}.${operationName}`,
        { service: serviceName, operation: operationName },
        { cause: error },
      )
    }
  }
}

function handlerKey(service: string, operation: string): string {
  return `${service}\u0000${operation}`
}

function validateServiceInput(
  service: string,
  operationName: string,
  operation: ServiceOperation,
  params: Record<string, unknown>,
): void {
  const schema = operation.input ?? {}
  const unknown = Object.keys(params).filter(name => !(name in schema))
  if (unknown.length > 0) {
    throw new ValidationFailureError(
      `Unknown input for service ${service}.${operationName}: ${unknown.join(', ')}`,
      { service, operation: operationName, fields: unknown },
    )
  }
  for (const [name, field] of Object.entries(schema)) {
    const value = params[name]
    if ((value === undefined || value === null) && field.required) {
      throw new ValidationFailureError(`Missing required service input: ${name}`, {
        service,
        operation: operationName,
        field: name,
      })
    }
    if (value !== undefined && value !== null) {
      try {
        validateValue(value, field, `input.${name}`)
      } catch (error) {
        throw new ValidationFailureError(`Invalid service input: ${name}`, {
          service,
          operation: operationName,
          field: name,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}

function validateExternalValue(
  value: unknown,
  schema: ExternalValueSchema,
  path: string,
  service: string,
  operation: string,
): void {
  try {
    if (value === undefined || value === null) throw new Error('result is required')
    validateValue(value, schema, path)
  } catch (error) {
    throw new ExternalResultValidationError(
      `Invalid external result from ${service}.${operation} at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { service, operation, path },
      { cause: error },
    )
  }
}

function validateValue(value: unknown, schema: ExternalValueSchema, path: string): void {
  if (value === undefined || value === null) {
    if (schema.required) throw new Error('value is required')
    return
  }
  if (schema.type === 'Object') {
    if (!isRecord(value)) throw new Error('expected Object')
    const fields = schema.fields ?? {}
    if (!schema.allowUnknown) {
      const unknown = Object.keys(value).filter(name => !(name in fields))
      if (unknown.length > 0) throw new Error(`unknown fields: ${unknown.join(', ')}`)
    }
    for (const [name, field] of Object.entries(fields)) {
      validateValue(value[name], field, `${path}.${name}`)
    }
    return
  }
  if (schema.type === 'Array') {
    if (!Array.isArray(value)) throw new Error('expected Array')
    const items = schema.items
    if (!items) throw new Error('array schema is missing items')
    value.forEach((item, index) => validateValue(item, items, `${path}[${index}]`))
    return
  }
  if (schema.type === 'Integer' && !(typeof value === 'number' && Number.isInteger(value))) throw new Error('expected Integer')
  if (schema.type === 'Float' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error('expected Float')
  if (schema.type === 'Boolean' && typeof value !== 'boolean') throw new Error('expected Boolean')
  if (schema.type === 'JSON' && typeof value !== 'object') throw new Error('expected JSON')
  if (schema.type === 'Enum') {
    if (typeof value !== 'string' || (schema.values && !schema.values.includes(value))) throw new Error('expected allowed Enum value')
  } else if (!['Integer', 'Float', 'Boolean', 'JSON'].includes(schema.type) && !(typeof value === 'string' || value instanceof Date)) {
    throw new Error(`expected ${schema.type}`)
  }
}

function transformExternalResult(
  transform: Record<string, unknown>,
  result: unknown,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return resolveTransform(transform, result, input) as Record<string, unknown>
}

function resolveTransform(value: unknown, result: unknown, input: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    if (value === '$result') return result
    if (value === '$input') return input
    if (value.startsWith('$result.')) return getPath(result, value.slice(8))
    if (value.startsWith('$input.')) return getPath(input, value.slice(7))
    return value
  }
  if (Array.isArray(value)) return value.map(item => resolveTransform(item, result, input))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTransform(item, result, input)]))
  }
  return value
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
