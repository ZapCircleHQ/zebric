import type { Hono } from 'hono'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { NotificationManager } from '@zebric/notifications'
import type { AuthProvider, SessionManager } from '@zebric/runtime-core'
import type { Blueprint } from '@zebric/runtime-core'
import { generateOpenAPISpec } from '@zebric/runtime-core'
import type { EngineConfig } from '../types/index.js'
import type { WorkflowManager } from '../workflows/index.js'
import type { QueryExecutor } from '../database/index.js'
import type { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import {
  getMimeType,
  resolveOrigin,
  getCallbackPath,
  tryParseBody,
  isUrlVerificationRequest,
  parseActionRequestBody,
  parseActionPayload,
  resolveActionRedirect,
  setFlashMessage,
  acceptsJson,
} from './server-utils.js'
import { resolveApiKeySession } from './server-security.js'
import {
  handleSkillEntityAction,
  handleSkillWorkflow,
  triggerEntityWorkflows,
  isStandardCrudRoute,
} from './server-action-handlers.js'

export function registerStaticUploads(app: Hono): void {
  const root = path.resolve(process.cwd(), 'data/uploads')
  app.get('/uploads/*', async (c) => {
    const relative = c.req.path.replace(/^\/uploads\/?/, '')
    const filePath = path.resolve(root, relative)
    // Prevent path traversal outside the uploads directory
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      return Response.json({ error: 'File not found' }, { status: 404 })
    }
    try {
      const data = await fs.readFile(filePath)
      const mimeType = getMimeType(filePath)
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': mimeType }
      })
    } catch {
      return Response.json({ error: 'File not found' }, { status: 404 })
    }
  })
}

export function registerAuthPages(app: Hono, blueprint: Blueprint, config: EngineConfig): void {
  app.get('/auth/sign-in', async (c) => {
    const callback = `${resolveOrigin(c.req.raw, config)}${getCallbackPath(c.req.raw)}`
    const RendererClass = config.rendererClass || (await import('../renderer/index.js')).HTMLRenderer
    const renderer = new RendererClass(blueprint, config.theme)
    return c.html(renderer.renderSignInPage(callback))
  })

  app.get('/auth/sign-up', async (c) => {
    const callback = `${resolveOrigin(c.req.raw, config)}${getCallbackPath(c.req.raw)}`
    const RendererClass = config.rendererClass || (await import('../renderer/index.js')).HTMLRenderer
    const renderer = new RendererClass(blueprint, config.theme)
    return c.html(renderer.renderSignUpPage(callback))
  })

  app.get('/auth/sign-out', async (c) => {
    const callback = `${resolveOrigin(c.req.raw, config)}${getCallbackPath(c.req.raw)}`
    const RendererClass = config.rendererClass || (await import('../renderer/index.js')).HTMLRenderer
    const renderer = new RendererClass(blueprint, config.theme)
    return c.html(renderer.renderSignOutPage(callback))
  })
}

export function registerAuthRoutes(app: Hono, authProvider: AuthProvider): void {
  app.all('/api/auth/*', async (c) => {
    try {
      const betterAuthInstance = authProvider.getAuthInstance()
      const response = await betterAuthInstance.handler(c.req.raw)
      return response
    } catch (error) {
      console.error('Auth route error:', error)
      return Response.json(
        {
          error: 'Authentication failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      )
    }
  })
}

export function registerWebhookRoutes(app: Hono, workflowManager?: WorkflowManager): void {
  if (!workflowManager) {
    return
  }

  app.all('/webhooks/*', async (c) => {
    try {
      const webhookPath = new URL(c.req.url).pathname
      const jobs = await workflowManager.triggerWebhook(webhookPath, {
        headers: Object.fromEntries(c.req.raw.headers),
        body: await tryParseBody(c.req.raw),
        query: Object.fromEntries(new URL(c.req.url).searchParams)
      })

      if (jobs.length === 0) {
        return Response.json(
          { error: 'No workflow found for this webhook', path: webhookPath },
          { status: 404 }
        )
      }

      return Response.json({
        success: true,
        message: `Triggered ${jobs.length} workflow(s)`,
        jobs: jobs.map((job) => ({
          id: job.id,
          workflow: job.workflowName,
          status: job.status
        }))
      })
    } catch (error) {
      console.error('Webhook error:', error)
      return Response.json(
        {
          error: 'Failed to trigger workflow',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      )
    }
  })
}

export function registerNotificationRoutes(
  app: Hono,
  notificationManager?: NotificationManager,
  workflowManager?: WorkflowManager
): void {
  app.all('/notifications/:adapterName/inbound', async (c) => {
    if (!notificationManager) {
      return Response.json({ error: 'Notification service not configured' }, { status: 404 })
    }

    const adapterName = c.req.param('adapterName')
    if (!adapterName) {
      return Response.json({ error: 'Notification adapter is required' }, { status: 400 })
    }

    const requestUrl = new URL(c.req.url)
    const inboundPath = requestUrl.pathname
    const requestData = {
      headers: Object.fromEntries(c.req.raw.headers),
      body: await tryParseBody(c.req.raw.clone()),
      query: Object.fromEntries(requestUrl.searchParams)
    }

    const response = await notificationManager.handleRequest(adapterName, c.req.raw)

    if (response.ok && workflowManager && !isUrlVerificationRequest(requestData.body)) {
      try {
        await workflowManager.triggerWebhook(inboundPath, requestData)
      } catch (error) {
        console.error(`Failed to trigger workflows for notification inbound path ${inboundPath}:`, error)
      }
    }

    return response
  })
}

export function registerActionRoutes(
  app: Hono,
  deps: {
    sessionManager: SessionManager
    queryExecutor: QueryExecutor
    workflowManager?: WorkflowManager
  }
): void {
  if (!deps.workflowManager) {
    return
  }

  const { sessionManager, queryExecutor, workflowManager } = deps

  app.post('/actions/:workflowName', async (c) => {
    const workflowName = c.req.param('workflowName')
    if (!workflowName) {
      return Response.json({ error: 'Workflow name is required' }, { status: 400 })
    }

    let body: Record<string, any> = {}

    try {
      body = await parseActionRequestBody(c)

      const session = await sessionManager.getSession(c.req.raw)
      if (!session) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const payload = parseActionPayload(body.payload)
      const entity = typeof body.entity === 'string' ? body.entity : undefined
      const recordId = typeof body.recordId === 'string' ? body.recordId : undefined
      const successMessage = typeof body.successMessage === 'string' ? body.successMessage : undefined
      const errorMessage = typeof body.errorMessage === 'string' ? body.errorMessage : undefined
      let record: any = null

      if (entity && recordId) {
        try {
          record = await queryExecutor.findById(entity, recordId)
        } catch (error) {
          console.warn(`Action workflow '${workflowName}' could not load ${entity}(${recordId})`, error)
        }
      }

      const workflow = workflowManager!.getWorkflow(workflowName)
      if (!workflow) {
        return Response.json(
          { error: `Workflow '${workflowName}' not found` },
          { status: 404 }
        )
      }

      const actionData = {
        payload,
        entity,
        recordId,
        record,
        page: body.page,
        redirect: body.redirect,
        session,
      }

      const job = workflowManager!.trigger(workflowName, actionData)

      const redirectTarget = resolveActionRedirect(
        typeof body.redirect === 'string' ? body.redirect : undefined,
        c.req.header('referer')
      )
      const message = successMessage || `Workflow "${workflowName}" started.`
      setFlashMessage(c, message, 'success')

      if (acceptsJson(c)) {
        return Response.json({
          success: true,
          job: { id: job.id, workflow: workflowName },
          message,
          redirect: redirectTarget
        })
      }

      return c.redirect(redirectTarget, 303)
    } catch (error) {
      console.error('Action route error:', error)
      const fallbackRedirect = resolveActionRedirect(
        typeof body.redirect === 'string' ? body.redirect : undefined,
        c.req.header('referer')
      )
      const errorMsg = (body && typeof body.errorMessage === 'string')
        ? body.errorMessage
        : 'Failed to trigger action'
      setFlashMessage(c, errorMsg, 'error')

      if (acceptsJson(c)) {
        return Response.json(
          {
            error: 'Failed to trigger action',
            details: error instanceof Error ? error.message : 'Unknown error',
            message: errorMsg,
            redirect: fallbackRedirect
          },
          { status: 500 }
        )
      }

      return c.redirect(fallbackRedirect, 303)
    }
  })
}

export function registerSkillRoutes(
  app: Hono,
  deps: {
    blueprint: Blueprint
    sessionManager: SessionManager
    queryExecutor: QueryExecutor
    workflowManager?: WorkflowManager
    apiKeys: Map<string, { name: string }>
  }
): void {
  const { blueprint, sessionManager, queryExecutor, workflowManager, apiKeys } = deps

  if (!blueprint.skills || blueprint.skills.length === 0) {
    return
  }

  const entityNames = new Set(blueprint.entities.map(e => e.name.toLowerCase()))

  for (const skill of blueprint.skills) {
    for (const action of skill.actions) {
      // Skip actions that map directly to standard CRUD routes
      if (isStandardCrudRoute(action, entityNames)) {
        continue
      }

      // Only register actions with entity+action or workflow annotations
      if (!action.entity && !action.workflow) {
        continue
      }

      // Convert {id} path syntax to Hono :id syntax
      const honoPath = action.path.replace(/\{(\w+)\}/g, ':$1')
      const method = action.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'

      app[method](honoPath, async (c) => {
        try {
          // Auth check — try API key first, then session
          const authHeader = c.req.header('authorization') || ''
          let session = null
          if (authHeader.toLowerCase().startsWith('bearer ')) {
            const token = authHeader.slice(7)
            session = resolveApiKeySession(token, apiKeys)
          }
          if (!session) {
            session = await sessionManager.getSession(c.req.raw)
          }
          if (skill.auth !== 'none' && !session) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }

          const actionDeps = { queryExecutor, workflowManager }

          if (action.workflow) {
            return await handleSkillWorkflow(c, action, session, actionDeps)
          }

          return await handleSkillEntityAction(c, action, session, actionDeps)
        } catch (error) {
          console.error(`Skill route error (${skill.name}/${action.name}):`, error)
          return Response.json(
            {
              error: 'Skill action failed',
              details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
          )
        }
      })
    }
  }
}

export function registerAPIRoutes(
  app: Hono,
  deps: {
    blueprint: Blueprint
    sessionManager: SessionManager
    queryExecutor: QueryExecutor
    workflowManager?: WorkflowManager
  }
): void {
  const { blueprint, sessionManager, queryExecutor, workflowManager } = deps

  if (!blueprint.entities || blueprint.entities.length === 0) {
    return
  }

  for (const entity of blueprint.entities) {
    const entityPath = `/api/${entity.name.toLowerCase()}s`
    const entityPathWithId = `${entityPath}/:id`

    app.post(entityPath, async (c) => {
      try {
        const data = await c.req.json<Record<string, any>>()
        const session = await sessionManager.getSession(c.req.raw)
        const result = await queryExecutor.create(entity.name, data, { session })
        await triggerEntityWorkflows(entity.name, 'create', undefined, result, workflowManager)
        return Response.json(result, { status: 201 })
      } catch (error) {
        console.error(`Create ${entity.name} error:`, error)
        return Response.json(
          {
            error: 'Create failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: 500 }
        )
      }
    })

    app.get(entityPath, async (c) => {
      try {
        const limitParam = parseInt(c.req.query('limit') || '', 10)
        const offsetParam = parseInt(c.req.query('offset') || '', 10)
        const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100, 1000)
        const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
        const results = await queryExecutor.execute(
          {
            entity: entity.name,
            orderBy: { createdAt: 'desc' },
            limit,
            offset,
          },
          {}
        )
        return Response.json(results)
      } catch (error) {
        console.error(`List ${entity.name} error:`, error)
        return Response.json(
          {
            error: 'List failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: 500 }
        )
      }
    })

    app.get(entityPathWithId, async (c) => {
      try {
        const { id } = c.req.param() as { id: string }
        const result = await queryExecutor.findById(entity.name, id)
        if (!result) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        return Response.json(result)
      } catch (error) {
        console.error(`Find ${entity.name} error:`, error)
        return Response.json(
          {
            error: 'Find failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: 500 }
        )
      }
    })

    app.put(entityPathWithId, async (c) => {
      try {
        const { id } = c.req.param() as { id: string }
        const data = await c.req.json<Record<string, any>>()
        const before = workflowManager
          ? await queryExecutor.findById(entity.name, id).catch(() => null)
          : null
        const session = await sessionManager.getSession(c.req.raw)
        const result = await queryExecutor.update(entity.name, id, data, { session })
        await triggerEntityWorkflows(entity.name, 'update', before, result, workflowManager)
        return Response.json(result)
      } catch (error) {
        console.error(`Update ${entity.name} error:`, error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        const statusCode = errorMessage.includes('not found') ? 404 : 500
        return Response.json(
          {
            error: 'Update failed',
            details: errorMessage
          },
          { status: statusCode }
        )
      }
    })

    app.delete(entityPathWithId, async (c) => {
      try {
        const { id } = c.req.param() as { id: string }
        const existing = workflowManager
          ? await queryExecutor.findById(entity.name, id).catch(() => null)
          : null
        const session = await sessionManager.getSession(c.req.raw)
        await queryExecutor.delete(entity.name, id, { session })
        await triggerEntityWorkflows(entity.name, 'delete', existing || { id }, undefined, workflowManager)
        return Response.json({ success: true })
      } catch (error) {
        console.error(`Delete ${entity.name} error:`, error)
        return Response.json(
          {
            error: 'Delete failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: 500 }
        )
      }
    })
  }
}

export function registerOpenAPIRoute(app: Hono, blueprint: Blueprint, config: EngineConfig): void {
  app.get('/api/openapi.json', async (c) => {
    const origin = resolveOrigin(c.req.raw, config)
    const spec = generateOpenAPISpec(blueprint, origin)
    return Response.json(spec, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    })
  })
}

export function registerPageRoutes(app: Hono, blueprintAdapter: BlueprintHttpAdapter): void {
  app.all('*', async (c) => {
    return blueprintAdapter.handle(c.req.raw)
  })
}
