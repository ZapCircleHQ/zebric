import { generateOpenAPISpec, type Blueprint, type OpenAPISpec } from '@zebric/runtime-core'
import type { Hono } from 'hono'

export function registerWorkersDiscoveryRoutes(app: Hono, blueprint: Blueprint): void {
  app.get('/.well-known/zebric-agent.json', async c => {
    const origin = new URL(c.req.url).origin
    const contract = await workersContract(blueprint)
    return Response.json({
      name: blueprint.project.name,
      version: blueprint.project.version,
      openapi: `${origin}/api/openapi.json`,
      contract,
      authentication: blueprint.auth?.apiKeys?.length ? [{ type: 'bearer' }] : [],
      skills: [],
      commands: [],
      capabilities: {
        entityApi: true,
        workflowJobs: false,
        idempotency: false,
        eventStream: false,
        transactionalWorkflows: false,
        d1BatchWorkflows: false,
        domainCommands: false,
        auditHistory: false,
      },
    }, { headers: discoveryHeaders() })
  })

  app.get('/api/openapi.json', async c => {
    const contract = await workersContract(blueprint)
    const spec = generateWorkersOpenApi(blueprint, new URL(c.req.url).origin)
    spec['x-zebric-contract'] = contract
    return Response.json(spec, {
      headers: {
        ...discoveryHeaders(),
        ETag: `"${contract.fingerprint}"`,
      },
    })
  })
}

export function generateWorkersOpenApi(blueprint: Blueprint, baseUrl?: string): OpenAPISpec {
  const auth = blueprint.auth ? 'required' as const : 'none' as const
  const skills = blueprint.entities.map(entity => {
    const path = `/api/${entity.name.toLowerCase()}s`
    const scope = (action: string) => `entity.${entity.name.toLowerCase()}.${action}`
    return {
      name: `${entity.name.toLowerCase()}_entity_api`,
      auth,
      actions: [
        { name: `list_${entity.name}`, method: 'GET' as const, path, entity: entity.name, action: 'list' as const, scopes: [scope('list')] },
        { name: `create_${entity.name}`, method: 'POST' as const, path, entity: entity.name, action: 'create' as const, scopes: [scope('create')] },
        { name: `get_${entity.name}`, method: 'GET' as const, path: `${path}/{id}`, entity: entity.name, action: 'get' as const, scopes: [scope('get')] },
        { name: `update_${entity.name}`, method: 'PUT' as const, path: `${path}/{id}`, entity: entity.name, action: 'update' as const, scopes: [scope('update')] },
        { name: `delete_${entity.name}`, method: 'DELETE' as const, path: `${path}/{id}`, entity: entity.name, action: 'delete' as const, scopes: [scope('delete')] },
      ],
    }
  })
  const supportedBlueprint: Blueprint = {
    ...blueprint,
    skills,
    commands: [],
    workflows: [],
  }
  const spec = generateOpenAPISpec(supportedBlueprint, baseUrl)
  delete spec.paths['/api/audit']
  if (!blueprint.auth?.apiKeys?.length) spec.security = []
  return spec
}

async function workersContract(blueprint: Blueprint): Promise<{ version: '1'; fingerprint: string }> {
  const canonical = JSON.stringify(stableJsonValue(generateWorkersOpenApi(blueprint)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return { version: '1', fingerprint: `sha256:${fingerprint}` }
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableJsonValue(entry)])
  )
}

function discoveryHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  }
}
