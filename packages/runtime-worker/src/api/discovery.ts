import { analyzeTransactionalWorkflow, commandOperationId, generateOpenAPISpec, type Blueprint, type OpenAPISpec } from '@zebric/runtime-core'
import type { Hono } from 'hono'

export interface WorkersDiscoveryOptions { durableWorkflows?: boolean; commandHandlers?: readonly string[] }

export function registerWorkersDiscoveryRoutes(app: Hono, blueprint: Blueprint, options: WorkersDiscoveryOptions = {}): void {
  // The Blueprint is static for the life of the isolate, so build the contract once.
  const publicDiscovery = !blueprint.auth
  let cachedContract: ReturnType<typeof workersContract> | undefined
  const build = async () => ({ contract: await (cachedContract ??= workersContract(blueprint, options)) })
  const headers = () => discoveryHeaders(publicDiscovery)
  app.get('/.well-known/zebric-agent.json', async c => {
    const origin = new URL(c.req.url).origin
    const { contract } = await build()
    const supported = supportedBlueprint(blueprint, options)
    return Response.json({
      name: blueprint.project.name,
      version: blueprint.project.version,
      openapi: `${origin}/api/openapi.json`,
      events: `${origin}/api/agent/events`,
      contract,
      authentication: blueprint.auth?.apiKeys?.length ? [{ type: 'bearer' }] : [],
      skills: supported.skills?.map(skill => skill.name) ?? [],
      commands: (supported.commands ?? []).map(command => ({
        name: command.name,
        operationId: commandOperationId(command.name),
        entity: command.entity,
        label: command.label,
        description: command.description,
        input: command.input ?? {},
        confirm: command.confirm,
        style: command.style,
        scopes: command.scopes ?? [],
      })),
      capabilities: {
        entityApi: true,
        workflowJobs: Boolean(supported.workflows?.length),
        durableWorkflowJobs: Boolean(options.durableWorkflows && supported.workflows?.length),
        workflowCancellation: Boolean(supported.workflows?.length),
        workflowRetries: Boolean(supported.workflows?.length),
        idempotency: true,
        durableCommandIdempotency: true,
        durableWorkflowEventOutbox: true,
        eventStream: true,
        durableDomainEvents: true,
        transactionalWorkflows: true,
        d1BatchWorkflows: Boolean(supported.workflows?.some(workflow => workflow.transactional)),
        domainCommands: Boolean(supported.commands?.length),
        auditHistory: true,
        transactionalAudit: true,
      },
    }, { headers: headers() })
  })

  app.get('/api/openapi.json', async c => {
    const { contract } = await build()
    const spec = generateWorkersOpenApi(blueprint, new URL(c.req.url).origin, options)
    spec['x-zebric-contract'] = contract
    return Response.json(spec, {
      headers: {
        ...headers(),
        ETag: `"${contract.fingerprint}"`,
      },
    })
  })
}

export function generateWorkersOpenApi(blueprint: Blueprint, baseUrl?: string, options: WorkersDiscoveryOptions = {}): OpenAPISpec {
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
  const supported = supportedBlueprint(blueprint, options)
  const apiBlueprint: Blueprint = {
    ...supported,
    skills: [...skills, ...(supported.skills ?? [])],
  }
  const spec = generateOpenAPISpec(apiBlueprint, baseUrl) as OpenAPISpec & {
    'x-zebric-workflows'?: { durable: boolean; retries: string; timeout: string }
  }
  spec['x-zebric-workflows'] = { durable: Boolean(options.durableWorkflows), retries: 'per-step', timeout: 'per-step' }
  for (const operation of ['cancel', 'retry'] as const) {
    spec.paths[`/api/jobs/{id}/${operation}`] = { post: {
      operationId: `${operation}_workflow_job`, summary: `${operation === 'cancel' ? 'Cancel' : 'Retry'} an owned workflow job`,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Job lifecycle operation accepted' }, '401': { description: 'Authentication required' }, '404': { description: 'Job not found' }, '409': { description: 'Job state conflict' } },
    } }
  }
  spec.paths['/api/agent/events'] = { get: {
    operationId: 'stream_agent_events', summary: 'Stream authorized durable command events',
    security: [{ bearerAuth: [] }],
    parameters: [{ name: 'Last-Event-ID', in: 'header', required: false, schema: { type: 'string', pattern: '^[0-9]+$' } }],
    responses: { '200': { description: 'Server-sent events; reconnect using Last-Event-ID', content: { 'text/event-stream': { schema: { type: 'string' } } } },
      '400': { description: 'Invalid cursor' }, '401': { description: 'Authentication required' } },
  } }
  if (!blueprint.auth?.apiKeys?.length) spec.security = []
  return spec
}

function supportedBlueprint(blueprint: Blueprint, options: WorkersDiscoveryOptions): Blueprint {
  const workflows = (blueprint.workflows ?? []).filter(workflow =>
    workflow.enabled !== false && (!workflow.transactional || analyzeTransactionalWorkflow(workflow, blueprint.commands ?? []).databaseOnly)
  )
  const workflowNames = new Set(workflows.map(workflow => workflow.name))
  const skills = (blueprint.skills ?? []).flatMap(skill => {
    const actions = skill.actions.filter(action => action.workflow && workflowNames.has(action.workflow))
    return actions.length > 0 ? [{ ...skill, actions }] : []
  })
  return {
    ...blueprint,
    commands: (blueprint.commands ?? []).filter(command => !command.handler || options.commandHandlers?.includes(command.handler)),
    workflows,
    skills,
  }
}

async function workersContract(blueprint: Blueprint, options: WorkersDiscoveryOptions): Promise<{ version: '1'; fingerprint: string }> {
  const canonical = JSON.stringify(stableJsonValue(generateWorkersOpenApi(blueprint, undefined, options)))
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

/** Open CORS and shared caching only for apps without [auth]; private apps stay same-origin. */
function discoveryHeaders(publicDiscovery: boolean): Record<string, string> {
  return publicDiscovery
    ? { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
    : { 'Cache-Control': 'private, max-age=300' }
}
