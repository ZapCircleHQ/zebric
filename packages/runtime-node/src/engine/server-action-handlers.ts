import type { Context } from 'hono'
import type { SkillAction } from '@zebric/runtime-core'
import type { WorkflowManager } from '../workflows/index.js'
import type { QueryExecutor } from '../database/index.js'

export interface ActionHandlerDeps {
  queryExecutor: QueryExecutor
  workflowManager?: WorkflowManager
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
      await triggerEntityWorkflows(entityName, 'create', undefined, result, workflowManager)
      return Response.json(result, { status: 201 })
    }

    case 'update': {
      const id = c.req.param('id')
      if (!id) {
        return Response.json({ error: 'Missing id parameter' }, { status: 400 })
      }
      const body = await c.req.json<Record<string, any>>()
      const before = workflowManager
        ? await queryExecutor.findById(entityName, id).catch(() => null)
        : null
      const result = await queryExecutor.update(entityName, id, body, { session })
      await triggerEntityWorkflows(entityName, 'update', before, result, workflowManager)
      return Response.json(result)
    }

    case 'list': {
      const where: Record<string, any> = {}
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
      const result = await queryExecutor.findById(entityName, id)
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
        ? await queryExecutor.findById(entityName, id).catch(() => null)
        : null
      await queryExecutor.delete(entityName, id, { session })
      await triggerEntityWorkflows(entityName, 'delete', existing || { id }, undefined, workflowManager)
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
    if (action.body && Object.keys(action.body).length > 0) {
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
    record = await queryExecutor.findById(action.entity, params.id).catch(() => null)
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
  }

  const job = workflowManager.trigger(workflowName, data)

  return Response.json({
    success: true,
    job: { id: job.id, workflow: workflowName },
  })
}

export async function triggerEntityWorkflows(
  entity: string,
  event: 'create' | 'update' | 'delete',
  before: any,
  after: any,
  workflowManager?: WorkflowManager
): Promise<void> {
  if (!workflowManager) {
    return
  }

  try {
    await workflowManager.triggerEntityEvent(entity, event, { before, after })
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
