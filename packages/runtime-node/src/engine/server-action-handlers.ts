import type { Context } from 'hono'
import type { SkillAction } from '@zebric/runtime-core'
import type { WorkflowManager } from '../workflows/index.js'
import type { QueryExecutor } from '../database/index.js'
import { resolveAgentAttribution } from './server-security.js'

function coerceQueryValue(value: string, type: string): string | number | boolean {
  if (type === 'Integer') {
    if (!/^-?\d+$/.test(value)) throw new Error(`Expected an integer, received "${value}"`)
    return Number.parseInt(value, 10)
  }
  if (type === 'Float') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received "${value}"`)
    return parsed
  }
  if (type === 'Boolean') {
    if (value === 'true') return true
    if (value === 'false') return false
    throw new Error(`Expected true or false, received "${value}"`)
  }
  return value
}

function parseSkillQuery(c: Context, action: SkillAction): Record<string, any> {
  const where: Record<string, any> = {}
  for (const [name, config] of Object.entries(action.query || {})) {
    const rawValue = c.req.query(name)
    const value = rawValue ?? config.default
    if (value === undefined) {
      if (config.required) throw new Error(`Missing required query parameter "${name}"`)
      continue
    }
    const coerced = typeof value === 'string' ? coerceQueryValue(value, config.type) : value
    if (config.values?.length && !config.values.includes(String(coerced))) {
      throw new Error(`Invalid value for query parameter "${name}"`)
    }
    if (name !== 'limit' && name !== 'offset') where[config.field || name] = coerced
  }
  return where
}

export interface ActionHandlerDeps {
  queryExecutor: QueryExecutor
  workflowManager?: WorkflowManager
}

function getCorrelationId(c: Context): string | undefined {
  return (c as any).get('correlationId') as string | undefined
    ?? c.req.header('x-correlation-id')
    ?? undefined
}

function getRequestId(c: Context): string | undefined {
  return (c as any).get('requestId') as string | undefined
    ?? undefined
}

export async function handleSkillEntityAction(
  c: Context,
  action: SkillAction,
  session: any,
  deps: ActionHandlerDeps
): Promise<Response> {
  const { queryExecutor, workflowManager } = deps
  const entityName = action.entity!

  switch (action.action) {
    case 'create': {
      const body = await c.req.json<Record<string, any>>()
      // Inject mapped path params as entity fields
      if (action.mapParams) {
        for (const [pathParam, entityField] of Object.entries(action.mapParams)) {
          const value = c.req.param(pathParam)
          if (value) {
            body[entityField] = value
          }
        }
      }
      const result = await queryExecutor.create(entityName, body, { session })
      await triggerEntityWorkflows(entityName, 'create', undefined, result, workflowManager, {
        correlationId: getCorrelationId(c),
        requestId: getRequestId(c),
      })
      return Response.json(result, { status: 201 })
    }

    case 'update': {
      const id = c.req.param('id')
      if (!id) {
        return Response.json({ error: 'Missing id parameter' }, { status: 400 })
      }
      const body = await c.req.json<Record<string, any>>()
      const before = workflowManager
        ? await queryExecutor.findById(entityName, id, { session }).catch(() => null)
        : null
      const result = await queryExecutor.update(entityName, id, body, { session })
      await triggerEntityWorkflows(entityName, 'update', before, result, workflowManager, {
        correlationId: getCorrelationId(c),
        requestId: getRequestId(c),
      })
      return Response.json(result)
    }

    case 'list': {
      let where: Record<string, any>
      try {
        where = parseSkillQuery(c, action)
      } catch (error) {
        return Response.json({
          error: 'Invalid query parameters',
          details: error instanceof Error ? error.message : String(error),
        }, { status: 400 })
      }
      if (action.mapParams) {
        for (const [pathParam, entityField] of Object.entries(action.mapParams)) {
          const value = c.req.param(pathParam)
          if (value) {
            where[entityField] = value
          }
        }
      }
      const limitParam = parseInt(c.req.query('limit') || '', 10)
      const offsetParam = parseInt(c.req.query('offset') || '', 10)
      const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100, 1000)
      const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
      const results = await queryExecutor.execute(
        {
          entity: entityName,
          where,
          orderBy: { createdAt: 'desc' },
          limit,
          offset,
        },
        { session }
      )
      return Response.json(results)
    }

    case 'get': {
      const id = c.req.param('id')
      if (!id) {
        return Response.json({ error: 'Missing id parameter' }, { status: 400 })
      }
      const result = await queryExecutor.findById(entityName, id, { session })
      if (!result) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      return Response.json(result)
    }

    case 'delete': {
      const id = c.req.param('id')
      if (!id) {
        return Response.json({ error: 'Missing id parameter' }, { status: 400 })
      }
      const existing = workflowManager
        ? await queryExecutor.findById(entityName, id, { session }).catch(() => null)
        : null
      await queryExecutor.delete(entityName, id, { session })
      await triggerEntityWorkflows(entityName, 'delete', existing || { id }, undefined, workflowManager, {
        correlationId: getCorrelationId(c),
        requestId: getRequestId(c),
      })
      return Response.json({ success: true })
    }

    default:
      return Response.json({ error: `Unknown action: ${action.action}` }, { status: 400 })
  }
}

export async function handleSkillWorkflow(
  c: Context,
  action: SkillAction,
  session: any,
  deps: ActionHandlerDeps
): Promise<Response> {
  const { queryExecutor, workflowManager } = deps

  if (!workflowManager) {
    return Response.json({ error: 'Workflow engine not available' }, { status: 500 })
  }

  const workflowName = action.workflow!
  const workflow = workflowManager.getWorkflow(workflowName)
  if (!workflow) {
    return Response.json({ error: `Workflow '${workflowName}' not found` }, { status: 404 })
  }

  let body: Record<string, any> = {}
  if (action.method !== 'GET') {
    const rawBody: Record<string, any> = await c.req.json<Record<string, any>>().catch(() => ({}))
    // If the action declares a body schema, only keep declared fields.
    // This prevents user-injected keys from reaching workflow templates
    // (e.g. an attacker adding a "url" field that a webhook step resolves).
    if (action.body !== undefined) {
      const allowed = new Set(Object.keys(action.body))
      for (const key of Object.keys(rawBody)) {
        if (allowed.has(key)) {
          body[key] = rawBody[key]
        }
      }
    } else {
      body = rawBody
    }
  }

  const params: Record<string, string> = {}
  const pathParams = action.path.match(/\{(\w+)\}/g)
  if (pathParams) {
    for (const param of pathParams) {
      const name = param.slice(1, -1)
      const value = c.req.param(name)
      if (value) params[name] = value
    }
  }

  // Load the record if entity is specified and we have an id
  let record = null
  if (action.entity && params.id) {
    record = await queryExecutor.findById(action.entity, params.id, { session }).catch(() => null)
  }

  const data = {
    params,
    body,
    payload: body,
    entity: action.entity,
    recordId: params.id,
    record,
    user: session?.user,
    session,
    attribution: resolveAgentAttribution(c, session),
  }

  const job = workflowManager.trigger(workflowName, data, {
    correlationId: getCorrelationId(c),
    requestId: getRequestId(c),
  })

  return Response.json({
    success: true,
    job: {
      id: job.id,
      workflow: workflowName,
      status: job.status,
      url: `/api/jobs/${job.id}`,
    },
  }, {
    status: 202,
    headers: { Location: `/api/jobs/${job.id}` },
  })
}

export async function triggerEntityWorkflows(
  entity: string,
  event: 'create' | 'update' | 'delete',
  before: any,
  after: any,
  workflowManager?: WorkflowManager,
  trace?: {
    correlationId?: string
    requestId?: string
  }
): Promise<void> {
  if (!workflowManager) {
    return
  }

  try {
    await workflowManager.triggerEntityEvent(entity, event, { before, after }, { trace })
  } catch (error) {
    console.error(`Failed to trigger ${event} workflows for ${entity}:`, error)
  }
}

export function isStandardCrudRoute(action: SkillAction, entityNames: Set<string>): boolean {
  // Match paths like /api/{entity}s and /api/{entity}s/:id
  const match = action.path.match(/^\/api\/(\w+?)s(?:\/\{id\})?$/)
  if (!match) return false

  const pathEntity = match[1]?.toLowerCase()
  return !!pathEntity && entityNames.has(pathEntity)
}
