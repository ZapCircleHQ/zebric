import { describe, it, expect } from 'vitest'
import { generateOpenAPISpec } from './openapi-generator.js'
import type { Blueprint } from '../types/blueprint.js'

function minimalBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    version: '1.0',
    project: {
      name: 'Test App',
      version: '0.1.0',
      description: 'A test application',
      runtime: { min_version: '0.1.0' },
    },
    entities: [
      {
        name: 'Issue',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'title', type: 'Text', required: true },
          { name: 'description', type: 'LongText' },
          { name: 'status', type: 'Enum', values: ['new', 'open', 'closed'], default: 'new' },
          { name: 'priority', type: 'Integer' },
          { name: 'isActive', type: 'Boolean' },
          { name: 'score', type: 'Float' },
          { name: 'metadata', type: 'JSON' },
          { name: 'email', type: 'Email' },
          { name: 'createdAt', type: 'DateTime', default: 'now' },
          { name: 'updatedAt', type: 'DateTime', default: 'now' },
        ],
      },
      {
        name: 'Comment',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'issueId', type: 'Ref', ref: 'Issue.id', required: true },
          { name: 'body', type: 'LongText', required: true },
          { name: 'authorType', type: 'Enum', values: ['user', 'agent', 'system'], default: 'user' },
          { name: 'createdAt', type: 'DateTime', default: 'now' },
        ],
      },
    ],
    pages: [],
    ...overrides,
  }
}

describe('generateOpenAPISpec', () => {
  it('returns a valid OpenAPI 3.1 structure', () => {
    const spec = generateOpenAPISpec(minimalBlueprint())

    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('Test App')
    expect(spec.info.version).toBe('0.1.0')
    expect(spec.info.description).toBe('A test application')
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
    })
    expect(spec.security).toEqual([{ bearerAuth: [] }])
  })

  it('includes server URL when baseUrl is provided', () => {
    const spec = generateOpenAPISpec(minimalBlueprint(), 'http://localhost:3000')

    expect(spec.servers).toEqual([{ url: 'http://localhost:3000' }])
  })

  it('omits servers when no baseUrl', () => {
    const spec = generateOpenAPISpec(minimalBlueprint())

    expect(spec.servers).toBeUndefined()
  })

  it('omits description when project has none', () => {
    const bp = minimalBlueprint()
    delete (bp.project as any).description
    const spec = generateOpenAPISpec(bp)

    expect(spec.info.description).toBeUndefined()
  })

  describe('entity schemas', () => {
    it('generates a schema per entity', () => {
      const spec = generateOpenAPISpec(minimalBlueprint())

      expect(spec.components.schemas.Issue).toBeDefined()
      expect(spec.components.schemas.Comment).toBeDefined()
    })

    it('generates Create schemas excluding auto fields', () => {
      const spec = generateOpenAPISpec(minimalBlueprint())
      const createSchema = spec.components.schemas.IssueCreate

      expect(createSchema).toBeDefined()
      expect(createSchema.properties.id).toBeUndefined()
      expect(createSchema.properties.createdAt).toBeUndefined()
      expect(createSchema.properties.updatedAt).toBeUndefined()
      expect(createSchema.properties.title).toBeDefined()
    })

    it('maps field types correctly', () => {
      const spec = generateOpenAPISpec(minimalBlueprint())
      const props = spec.components.schemas.Issue.properties

      expect(props.id).toEqual({ type: 'string' })
      expect(props.title).toEqual({ type: 'string' })
      expect(props.description).toEqual({ type: 'string' })
      expect(props.priority).toEqual({ type: 'integer' })
      expect(props.isActive).toEqual({ type: 'boolean' })
      expect(props.score).toEqual({ type: 'number' })
      expect(props.metadata).toEqual({ type: 'object' })
      expect(props.email).toEqual({ type: 'string', format: 'email' })
      expect(props.createdAt).toEqual({ type: 'string', format: 'date-time' })
    })

    it('maps Enum fields with values', () => {
      const spec = generateOpenAPISpec(minimalBlueprint())
      const props = spec.components.schemas.Issue.properties

      expect(props.status).toEqual({
        type: 'string',
        enum: ['new', 'open', 'closed'],
      })
    })

    it('sets required fields correctly', () => {
      const spec = generateOpenAPISpec(minimalBlueprint())

      // Issue full schema: title is required (no default, not primary_key)
      // status has default, so not in required
      const issueSchema = spec.components.schemas.Issue
      expect(issueSchema.required).toContain('title')
      expect(issueSchema.required).not.toContain('status')
      expect(issueSchema.required).not.toContain('id')

      // Comment: issueId and body are required
      const commentSchema = spec.components.schemas.Comment
      expect(commentSchema.required).toContain('issueId')
      expect(commentSchema.required).toContain('body')
    })

    it('omits required array when no fields are required', () => {
      const bp = minimalBlueprint({
        entities: [
          {
            name: 'Simple',
            fields: [
              { name: 'id', type: 'ULID', primary_key: true },
              { name: 'label', type: 'Text' },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)

      expect(spec.components.schemas.Simple.required).toBeUndefined()
    })
  })

  describe('paths from skills', () => {
    it('generates no paths when no skills defined', () => {
      const spec = generateOpenAPISpec(minimalBlueprint())

      expect(spec.paths).toEqual({})
    })

    it('generates paths for skill actions', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            description: 'Manage issues',
            actions: [
              {
                name: 'create_issue',
                description: 'Create a new issue.',
                method: 'POST',
                path: '/api/issues',
              },
              {
                name: 'get_issue',
                description: 'Fetch an issue by id.',
                method: 'GET',
                path: '/api/issues/{id}',
              },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)

      expect(spec.paths['/api/issues']).toBeDefined()
      expect(spec.paths['/api/issues'].post).toBeDefined()
      expect(spec.paths['/api/issues/{id}']).toBeDefined()
      expect(spec.paths['/api/issues/{id}'].get).toBeDefined()
    })

    it('sets operationId as skill_action', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              { name: 'get_issue', method: 'GET', path: '/api/issues/{id}' },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)
      const op = spec.paths['/api/issues/{id}'].get

      expect(op.operationId).toBe('dispatch_get_issue')
      expect(op.tags).toEqual(['dispatch'])
    })

    it('includes path parameters from {id} patterns', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              { name: 'get_issue', method: 'GET', path: '/api/issues/{id}' },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)
      const op = spec.paths['/api/issues/{id}'].get

      expect(op.parameters).toEqual([
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ])
    })

    it('includes request body from explicit body definition', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              {
                name: 'set_status',
                method: 'POST',
                path: '/api/issues/{id}/status',
                body: { status: 'Enum' },
                entity: 'Issue',
                action: 'update',
              },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)
      const op = spec.paths['/api/issues/{id}/status'].post

      expect(op.requestBody).toBeDefined()
      expect(op.requestBody.required).toBe(true)
      const schema = op.requestBody.content['application/json'].schema
      expect(schema.properties.status).toBeDefined()
      // Should resolve enum values from the Issue entity
      expect(schema.properties.status.enum).toEqual(['new', 'open', 'closed'])
    })

    it('uses entity Create schema ref for create actions without explicit body', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              {
                name: 'create_issue',
                method: 'POST',
                path: '/api/issues',
                entity: 'Issue',
                action: 'create',
              },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)
      const op = spec.paths['/api/issues'].post

      expect(op.requestBody.content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/IssueCreate',
      })
    })

    it('returns 201 for create actions', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              {
                name: 'create_issue',
                method: 'POST',
                path: '/api/issues',
                entity: 'Issue',
                action: 'create',
              },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)
      const op = spec.paths['/api/issues'].post

      expect(op.responses['201']).toBeDefined()
      expect(op.responses['201'].description).toBe('Created')
    })

    it('returns array schema for list actions', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              {
                name: 'get_audit',
                method: 'GET',
                path: '/api/issues/{id}/audit',
                entity: 'Comment',
                action: 'list',
              },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)
      const op = spec.paths['/api/issues/{id}/audit'].get

      expect(op.responses['200'].content['application/json'].schema).toEqual({
        type: 'array',
        items: { $ref: '#/components/schemas/Comment' },
      })
    })

    it('includes 404 response for get/update/delete actions', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              { name: 'get_issue', method: 'GET', path: '/api/issues/{id}', entity: 'Issue', action: 'get' },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)

      expect(spec.paths['/api/issues/{id}'].get.responses['404']).toBeDefined()
    })

    it('always includes 401 response', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              { name: 'list_issues', method: 'GET', path: '/api/issues', entity: 'Issue', action: 'list' },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)

      expect(spec.paths['/api/issues'].get.responses['401']).toEqual({
        description: 'Unauthorized',
      })
    })

    it('handles multiple skills on the same path (different methods)', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              { name: 'create_issue', method: 'POST', path: '/api/issues' },
              { name: 'list_issues', method: 'GET', path: '/api/issues' },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)

      expect(spec.paths['/api/issues'].post).toBeDefined()
      expect(spec.paths['/api/issues'].get).toBeDefined()
    })

    it('includes pagination query params for list actions', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              {
                name: 'get_audit',
                method: 'GET',
                path: '/api/issues/{id}/audit',
                entity: 'Comment',
                action: 'list',
              },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)
      const op = spec.paths['/api/issues/{id}/audit'].get
      const paramNames = op.parameters.map((p: any) => p.name)

      expect(paramNames).toContain('limit')
      expect(paramNames).toContain('offset')

      const limitParam = op.parameters.find((p: any) => p.name === 'limit')
      expect(limitParam.in).toBe('query')
      expect(limitParam.schema.type).toBe('integer')
      expect(limitParam.schema.default).toBe(100)
      expect(limitParam.schema.maximum).toBe(1000)

      const offsetParam = op.parameters.find((p: any) => p.name === 'offset')
      expect(offsetParam.in).toBe('query')
      expect(offsetParam.schema.type).toBe('integer')
      expect(offsetParam.schema.default).toBe(0)
    })

    it('does not include pagination params for non-list actions', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              {
                name: 'get_issue',
                method: 'GET',
                path: '/api/issues/{id}',
                entity: 'Issue',
                action: 'get',
              },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)
      const op = spec.paths['/api/issues/{id}'].get
      const paramNames = op.parameters.map((p: any) => p.name)

      expect(paramNames).not.toContain('limit')
      expect(paramNames).not.toContain('offset')
    })

    it('includes both path params and pagination params for list actions with path params', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              {
                name: 'get_audit',
                method: 'GET',
                path: '/api/issues/{id}/audit',
                entity: 'Comment',
                action: 'list',
              },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)
      const op = spec.paths['/api/issues/{id}/audit'].get
      const paramNames = op.parameters.map((p: any) => p.name)

      expect(paramNames).toContain('id')
      expect(paramNames).toContain('limit')
      expect(paramNames).toContain('offset')
      expect(op.parameters).toHaveLength(3)
    })

    it('includes description in operation when provided', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              { name: 'get_issue', description: 'Fetch an issue by id.', method: 'GET', path: '/api/issues/{id}' },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)

      expect(spec.paths['/api/issues/{id}'].get.description).toBe('Fetch an issue by id.')
    })

    it('omits description when not provided', () => {
      const bp = minimalBlueprint({
        skills: [
          {
            name: 'dispatch',
            actions: [
              { name: 'get_issue', method: 'GET', path: '/api/issues/{id}' },
            ],
          },
        ],
      })
      const spec = generateOpenAPISpec(bp)

      expect(spec.paths['/api/issues/{id}'].get.description).toBeUndefined()
    })
  })
})
