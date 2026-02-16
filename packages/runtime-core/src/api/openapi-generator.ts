/**
 * OpenAPI 3.1 Spec Generator
 *
 * Generates an OpenAPI specification from blueprint skills and entities.
 */

import type { Blueprint, Entity, Field, SkillConfig, SkillAction } from '../types/blueprint.js'

export interface OpenAPISpec {
  openapi: string
  info: {
    title: string
    description?: string
    version: string
  }
  servers?: Array<{ url: string }>
  paths: Record<string, any>
  components: {
    schemas: Record<string, any>
    securitySchemes: Record<string, any>
  }
  security: Array<Record<string, any[]>>
}

const FIELD_TYPE_MAP: Record<string, { type: string; format?: string }> = {
  Text: { type: 'string' },
  LongText: { type: 'string' },
  Email: { type: 'string', format: 'email' },
  Integer: { type: 'integer' },
  Float: { type: 'number' },
  Boolean: { type: 'boolean' },
  DateTime: { type: 'string', format: 'date-time' },
  Date: { type: 'string', format: 'date' },
  JSON: { type: 'object' },
  Ref: { type: 'string' },
  ULID: { type: 'string' },
  UUID: { type: 'string', format: 'uuid' },
  Enum: { type: 'string' },
}

function fieldToJsonSchema(field: Field): Record<string, any> {
  const mapped = FIELD_TYPE_MAP[field.type] || { type: 'string' }
  const schema: Record<string, any> = { ...mapped }

  if (field.type === 'Enum' && field.values && field.values.length > 0) {
    schema.enum = field.values
  }

  return schema
}

function entityToSchema(entity: Entity): Record<string, any> {
  const properties: Record<string, any> = {}
  const required: string[] = []

  for (const field of entity.fields) {
    properties[field.name] = fieldToJsonSchema(field)

    if (field.required && !field.primary_key && !field.default) {
      required.push(field.name)
    }
  }

  const schema: Record<string, any> = {
    type: 'object',
    properties,
  }

  if (required.length > 0) {
    schema.required = required
  }

  return schema
}

function entityToCreateSchema(entity: Entity): Record<string, any> {
  const autoFields = new Set(['id', 'createdAt', 'updatedAt'])
  const properties: Record<string, any> = {}
  const required: string[] = []

  for (const field of entity.fields) {
    if (autoFields.has(field.name)) continue

    properties[field.name] = fieldToJsonSchema(field)

    if (field.required && !field.default) {
      required.push(field.name)
    }
  }

  const schema: Record<string, any> = {
    type: 'object',
    properties,
  }

  if (required.length > 0) {
    schema.required = required
  }

  return schema
}

function buildRequestBody(action: SkillAction, entityMap: Map<string, Entity>): Record<string, any> | undefined {
  // If action has explicit body definition, use that
  if (action.body && Object.keys(action.body).length > 0) {
    const properties: Record<string, any> = {}
    for (const [fieldName, fieldType] of Object.entries(action.body)) {
      const mapped = FIELD_TYPE_MAP[fieldType] || { type: 'string' }
      properties[fieldName] = { ...mapped }

      // Try to get enum values from the target entity
      if (fieldType === 'Enum' && action.entity) {
        const entity = entityMap.get(action.entity)
        if (entity) {
          const entityField = entity.fields.find(f => f.name === fieldName)
          if (entityField?.values) {
            properties[fieldName].enum = entityField.values
          }
        }
      }
    }

    return {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties,
          },
        },
      },
    }
  }

  // If action creates an entity, reference the Create schema
  if (action.action === 'create' && action.entity) {
    return {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${action.entity}Create` },
        },
      },
    }
  }

  // If action updates an entity, use a generic partial body
  if (action.action === 'update' && action.entity) {
    return {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${action.entity}Create` },
        },
      },
    }
  }

  return undefined
}

function buildResponses(action: SkillAction): Record<string, any> {
  const statusCode = action.action === 'create' ? '201' : '200'
  const description = action.action === 'create' ? 'Created' : 'Success'

  const response: Record<string, any> = { description }

  if (action.entity) {
    if (action.action === 'list') {
      response.content = {
        'application/json': {
          schema: {
            type: 'array',
            items: { $ref: `#/components/schemas/${action.entity}` },
          },
        },
      }
    } else if (action.action !== 'delete') {
      response.content = {
        'application/json': {
          schema: { $ref: `#/components/schemas/${action.entity}` },
        },
      }
    }
  }

  const responses: Record<string, any> = {
    [statusCode]: response,
    '401': { description: 'Unauthorized' },
  }

  if (action.entity && (action.action === 'get' || action.action === 'update' || action.action === 'delete')) {
    responses['404'] = { description: 'Not found' }
  }

  return responses
}

function extractPathParams(path: string): string[] {
  const params: string[] = []
  const regex = /\{(\w+)\}/g
  let match
  while ((match = regex.exec(path)) !== null) {
    if (match[1]) {
      params.push(match[1])
    }
  }
  return params
}

function buildOperation(
  skill: SkillConfig,
  action: SkillAction,
  entityMap: Map<string, Entity>
): Record<string, any> {
  const operation: Record<string, any> = {
    operationId: `${skill.name}_${action.name}`,
    tags: [skill.name],
  }

  if (action.description) {
    operation.description = action.description
  }

  // Path parameters
  const pathParams = extractPathParams(action.path)
  if (pathParams.length > 0) {
    operation.parameters = pathParams.map(param => ({
      name: param,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }))
  }

  // Pagination query params for list actions
  if (action.action === 'list') {
    operation.parameters = [
      ...(operation.parameters || []),
      { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 1000 }, description: 'Maximum number of records to return (default 100, max 1000).' },
      { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Number of records to skip.' },
    ]
  }

  // Request body
  const requestBody = buildRequestBody(action, entityMap)
  if (requestBody) {
    operation.requestBody = requestBody
  }

  // Responses
  operation.responses = buildResponses(action)

  return operation
}

export function generateOpenAPISpec(blueprint: Blueprint, baseUrl?: string): OpenAPISpec {
  const entityMap = new Map<string, Entity>()
  for (const entity of blueprint.entities) {
    entityMap.set(entity.name, entity)
  }

  // Build component schemas from entities
  const schemas: Record<string, any> = {}
  for (const entity of blueprint.entities) {
    schemas[entity.name] = entityToSchema(entity)
    schemas[`${entity.name}Create`] = entityToCreateSchema(entity)
  }

  // Build paths from skills
  const paths: Record<string, any> = {}

  if (blueprint.skills) {
    for (const skill of blueprint.skills) {
      for (const action of skill.actions) {
        const pathKey = action.path
        if (!paths[pathKey]) {
          paths[pathKey] = {}
        }

        const method = action.method.toLowerCase()
        paths[pathKey][method] = buildOperation(skill, action, entityMap)
      }
    }
  }

  const spec: OpenAPISpec = {
    openapi: '3.1.0',
    info: {
      title: blueprint.project.name,
      version: blueprint.project.version,
    },
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  }

  if (blueprint.project.description) {
    spec.info.description = blueprint.project.description
  }

  if (baseUrl) {
    spec.servers = [{ url: baseUrl }]
  }

  return spec
}
