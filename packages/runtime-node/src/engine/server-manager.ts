import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve, type ServerType } from '@hono/node-server'
import { getCookie, setCookie } from 'hono/cookie'
import { ulid } from 'ulid'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { NotificationManager } from '@zebric/notifications'
import type { AuthProvider, SessionManager } from '@zebric/runtime-core'
import type { Blueprint, SkillAction } from '@zebric/runtime-core'
import { generateOpenAPISpec } from '@zebric/runtime-core'
import type { EngineConfig, EngineState } from '../types/index.js'
import type { SchemaDiffResult } from '../database/index.js'
import type { WorkflowManager } from '../workflows/index.js'
import type { QueryExecutor } from '../database/index.js'
import type { PluginRegistry } from '../plugins/index.js'
import type { MetricsRegistry } from '../monitoring/metrics.js'
import type { RequestTracer } from '../monitoring/request-tracer.js'
import { SpanType, SpanStatus } from '../monitoring/request-tracer.js'
import type { ErrorHandler } from '../errors/index.js'
import { BlueprintHttpAdapter } from '@zebric/runtime-hono'

export interface ServerManagerDependencies {
  blueprint: Blueprint
  config: EngineConfig
  state: EngineState
  authProvider: AuthProvider
  sessionManager: SessionManager
  queryExecutor: QueryExecutor
  workflowManager?: WorkflowManager
  plugins: PluginRegistry
  blueprintAdapter: BlueprintHttpAdapter
  metrics: MetricsRegistry
  tracer: RequestTracer
  errorHandler: ErrorHandler
  pendingSchemaDiff: SchemaDiffResult | null
  notificationManager?: NotificationManager
  getHealthStatus?: () => Promise<any>
}

export class ServerManager {
  private app!: Hono
  private server?: ServerType
  private blueprint: Blueprint
  private config: EngineConfig
  private state: EngineState
  private authProvider: AuthProvider
  private sessionManager: SessionManager
  private queryExecutor: QueryExecutor
  private workflowManager?: WorkflowManager
  private plugins: PluginRegistry
  private blueprintAdapter: BlueprintHttpAdapter
  private metrics: MetricsRegistry
  private tracer: RequestTracer
  private errorHandler: ErrorHandler
  private getHealthStatusFn?: () => Promise<any>
  private notificationManager?: NotificationManager
  private rateLimitStore = new Map<string, { count: number; resetAt: number }>()
  private apiKeys = new Map<string, { name: string }>()
  private csrfCookieName = 'csrf-token'

  constructor(deps: ServerManagerDependencies) {
    this.blueprint = deps.blueprint
    this.config = deps.config
    this.state = deps.state
    this.authProvider = deps.authProvider
    this.sessionManager = deps.sessionManager
    this.queryExecutor = deps.queryExecutor
    this.workflowManager = deps.workflowManager
    this.plugins = deps.plugins
    this.blueprintAdapter = deps.blueprintAdapter
    this.metrics = deps.metrics
    this.tracer = deps.tracer
    this.errorHandler = deps.errorHandler
    this.notificationManager = deps.notificationManager
    this.getHealthStatusFn = deps.getHealthStatus
  }

  updateDependencies(updates: Partial<ServerManagerDependencies>): void {
    if (updates.blueprint) this.blueprint = updates.blueprint
    if (updates.config) this.config = updates.config
    if (updates.state) this.state = updates.state
    if (updates.authProvider) this.authProvider = updates.authProvider
    if (updates.sessionManager) this.sessionManager = updates.sessionManager
    if (updates.queryExecutor) this.queryExecutor = updates.queryExecutor
    if (updates.workflowManager !== undefined) this.workflowManager = updates.workflowManager
    if (updates.plugins) this.plugins = updates.plugins
    if (updates.blueprintAdapter) this.blueprintAdapter = updates.blueprintAdapter
    if (updates.metrics) this.metrics = updates.metrics
    if (updates.tracer) this.tracer = updates.tracer
    if (updates.errorHandler) this.errorHandler = updates.errorHandler
    if (updates.notificationManager !== undefined) this.notificationManager = updates.notificationManager
    if (updates.getHealthStatus) this.getHealthStatusFn = updates.getHealthStatus
  }

  async start(): Promise<ServerType> {
    this.app = new Hono()
    this.app.onError(this.errorHandler.toHonoHandler())
    this.registerGlobalMiddleware()
    this.registerRoutes()

    this.initApiKeys()

    const port = this.config.port || 3000
    const host = this.config.host || '0.0.0.0'
    this.server = serve(
      {
        fetch: this.app.fetch,
        port,
        hostname: host
      },
      () => {
        console.log(`✅ HTTP Server listening on ${host}:${port}`)
      }
    )

    return this.server
  }

  async stop(): Promise<void> {
    if (this.server && 'close' in this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err?: Error) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
  }

  getServer(): ServerType | undefined {
    return this.server
  }

  private registerGlobalMiddleware(): void {
    this.app.use('*', async (c, next) => {
      const requestId = ulid()
      const traceId = requestId
      Reflect.set(c.req.raw, 'requestId', requestId)
      Reflect.set(c.req.raw, 'traceId', traceId)

      const now = this.metrics.now()
      const url = new URL(c.req.url)

      this.tracer.startTrace(traceId, c.req.method, url.pathname)
      const spanId = this.tracer.startSpan(
        traceId,
        SpanType.HTTP_REQUEST,
        `${c.req.method} ${url.pathname}`,
        {
          method: c.req.method,
          url: c.req.url,
          headers: Array.from(c.req.raw.headers.keys()),
          ip: this.getClientIp(c),
          userAgent: c.req.header('user-agent')
        }
      )

      const rateLimitResponse = this.applyRateLimiting(c)
      if (rateLimitResponse) {
        return rateLimitResponse
      }

      const csrfResponse = await this.applyCsrfProtection(c)
      if (csrfResponse) {
        return csrfResponse
      }

      let response: Response | void
      try {
        response = await next()
      } finally {
        const duration = this.metrics.now() - now
        const statusCode = c.res.status ?? 200
        this.metrics.recordRequest(url.pathname, statusCode, duration)

        const spanStatus = statusCode >= 400 ? SpanStatus.ERROR : SpanStatus.OK
        this.tracer.endSpan(spanId, spanStatus, {
          statusCode
        })
        this.tracer.endTrace(
          traceId,
          statusCode,
          statusCode >= 500 ? `HTTP ${statusCode}` : undefined
        )

        this.applySecurityHeaders(c, requestId, traceId)
      }

      return response
    })
  }

  private registerRoutes(): void {
    this.app.get('/health', async () => {
      const health = this.getHealthStatusFn ? await this.getHealthStatusFn() : this.getHealthStatus()
      return Response.json(health, { status: health.healthy ? 200 : 503 })
    })

    this.app.get('/metrics', async () => {
      return new Response(this.metrics.toPrometheus(), {
        status: 200,
        headers: { 'Content-Type': 'text/plain; version=0.0.4' }
      })
    })

    this.registerStaticUploads()
    this.registerAuthPages()
    this.registerAuthRoutes()
    this.registerWebhookRoutes()
    this.registerNotificationRoutes()
    this.registerActionRoutes()
    this.registerSkillRoutes()
    this.registerAPIRoutes()
    this.registerOpenAPIRoute()
    this.registerPageRoutes()

    this.app.notFound(() => {
      return Response.json(
        {
          error: 'Not Found',
          message: 'The requested page does not exist'
        },
        { status: 404 }
      )
    })
  }

  private registerNotificationRoutes(): void {
    this.app.all('/notifications/:adapterName/inbound', async (c) => {
      if (!this.notificationManager) {
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
        body: await this.tryParseBody(c.req.raw.clone()),
        query: Object.fromEntries(requestUrl.searchParams)
      }

      const response = await this.notificationManager.handleRequest(adapterName, c.req.raw)

      if (response.ok && this.workflowManager && !this.isUrlVerificationRequest(requestData.body)) {
        try {
          await this.workflowManager.triggerWebhook(inboundPath, requestData)
        } catch (error) {
          console.error(`Failed to trigger workflows for notification inbound path ${inboundPath}:`, error)
        }
      }

      return response
    })
  }

  private registerStaticUploads(): void {
    const root = path.resolve(process.cwd(), 'data/uploads')
    this.app.get('/uploads/*', async (c) => {
      const relative = c.req.path.replace(/^\/uploads\/?/, '')
      const filePath = path.resolve(root, relative)
      // Prevent path traversal outside the uploads directory
      if (!filePath.startsWith(root + path.sep) && filePath !== root) {
        return Response.json({ error: 'File not found' }, { status: 404 })
      }
      try {
        const data = await fs.readFile(filePath)
        const mimeType = this.getMimeType(filePath)
        return new Response(data, {
          status: 200,
          headers: { 'Content-Type': mimeType }
        })
      } catch {
        return Response.json({ error: 'File not found' }, { status: 404 })
      }
    })
  }

  private registerAuthPages(): void {
    this.app.get('/auth/sign-in', async (c) => {
      const callback = `${this.resolveOrigin(c.req.raw)}${this.getCallbackPath(c.req.raw)}`
      const RendererClass = this.config.rendererClass || (await import('../renderer/index.js')).HTMLRenderer
      const renderer = new RendererClass(this.blueprint, this.config.theme)
      return c.html(renderer.renderSignInPage(callback))
    })

    this.app.get('/auth/sign-up', async (c) => {
      const callback = `${this.resolveOrigin(c.req.raw)}${this.getCallbackPath(c.req.raw)}`
      const RendererClass = this.config.rendererClass || (await import('../renderer/index.js')).HTMLRenderer
      const renderer = new RendererClass(this.blueprint, this.config.theme)
      return c.html(renderer.renderSignUpPage(callback))
    })

    this.app.get('/auth/sign-out', async (c) => {
      const callback = `${this.resolveOrigin(c.req.raw)}${this.getCallbackPath(c.req.raw)}`
      const RendererClass = this.config.rendererClass || (await import('../renderer/index.js')).HTMLRenderer
      const renderer = new RendererClass(this.blueprint, this.config.theme)
      return c.html(renderer.renderSignOutPage(callback))
    })
  }

  private registerAuthRoutes(): void {
    this.app.all('/api/auth/*', async (c) => {
      try {
        const betterAuthInstance = this.authProvider.getAuthInstance()
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

  private registerWebhookRoutes(): void {
    if (!this.workflowManager) {
      return
    }

    this.app.all('/webhooks/*', async (c) => {
      try {
        const webhookPath = new URL(c.req.url).pathname
        const jobs = await this.workflowManager!.triggerWebhook(webhookPath, {
          headers: Object.fromEntries(c.req.raw.headers),
          body: await this.tryParseBody(c.req.raw),
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

  private registerActionRoutes(): void {
    if (!this.workflowManager) {
      return
    }

    this.app.post('/actions/:workflowName', async (c) => {
      const workflowName = c.req.param('workflowName')
      if (!workflowName) {
        return Response.json({ error: 'Workflow name is required' }, { status: 400 })
      }

      let body: Record<string, any> = {}

      try {
        body = await this.parseActionRequestBody(c)

        const session = await this.sessionManager.getSession(c.req.raw)
        if (!session) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const payload = this.parseActionPayload(body.payload)
        const entity = typeof body.entity === 'string' ? body.entity : undefined
        const recordId = typeof body.recordId === 'string' ? body.recordId : undefined
        const successMessage = typeof body.successMessage === 'string' ? body.successMessage : undefined
        const errorMessage = typeof body.errorMessage === 'string' ? body.errorMessage : undefined
        let record: any = null

        if (entity && recordId) {
          try {
            record = await this.queryExecutor.findById(entity, recordId)
          } catch (error) {
            console.warn(`Action workflow '${workflowName}' could not load ${entity}(${recordId})`, error)
          }
        }

        const workflow = this.workflowManager!.getWorkflow(workflowName)
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

        const job = this.workflowManager!.trigger(workflowName, actionData)

        const redirectTarget = this.resolveActionRedirect(
          typeof body.redirect === 'string' ? body.redirect : undefined,
          c.req.header('referer')
        )
        const message = successMessage || `Workflow "${workflowName}" started.`
        this.setFlashMessage(c, message, 'success')

        if (this.acceptsJson(c)) {
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
        const fallbackRedirect = this.resolveActionRedirect(
          typeof body.redirect === 'string' ? body.redirect : undefined,
          c.req.header('referer')
        )
        const errorMessage = (body && typeof body.errorMessage === 'string')
          ? body.errorMessage
          : 'Failed to trigger action'
        this.setFlashMessage(c, errorMessage, 'error')

        if (this.acceptsJson(c)) {
          return Response.json(
            {
              error: 'Failed to trigger action',
              details: error instanceof Error ? error.message : 'Unknown error',
              message: errorMessage,
              redirect: fallbackRedirect
            },
            { status: 500 }
          )
        }

        return c.redirect(fallbackRedirect, 303)
      }
    })
  }

  private registerAPIRoutes(): void {
    if (!this.blueprint.entities || this.blueprint.entities.length === 0) {
      return
    }

    for (const entity of this.blueprint.entities) {
      const entityPath = `/api/${entity.name.toLowerCase()}s`
      const entityPathWithId = `${entityPath}/:id`

      this.app.post(entityPath, async (c) => {
        try {
          const data = await c.req.json<Record<string, any>>()
          const session = await this.sessionManager.getSession(c.req.raw)
          const result = await this.queryExecutor.create(entity.name, data, { session })
          await this.triggerEntityWorkflows(entity.name, 'create', undefined, result)
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

      this.app.get(entityPath, async (c) => {
        try {
          const limitParam = parseInt(c.req.query('limit') || '', 10)
          const offsetParam = parseInt(c.req.query('offset') || '', 10)
          const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100, 1000)
          const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined
          const results = await this.queryExecutor.execute(
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

      this.app.get(entityPathWithId, async (c) => {
        try {
          const { id } = c.req.param() as { id: string }
          const result = await this.queryExecutor.findById(entity.name, id)
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

      this.app.put(entityPathWithId, async (c) => {
        try {
          const { id } = c.req.param() as { id: string }
          const data = await c.req.json<Record<string, any>>()
          const before = this.workflowManager
            ? await this.queryExecutor.findById(entity.name, id).catch(() => null)
            : null
          const session = await this.sessionManager.getSession(c.req.raw)
          const result = await this.queryExecutor.update(entity.name, id, data, { session })
          await this.triggerEntityWorkflows(entity.name, 'update', before, result)
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

      this.app.delete(entityPathWithId, async (c) => {
        try {
          const { id } = c.req.param() as { id: string }
          const existing = this.workflowManager
            ? await this.queryExecutor.findById(entity.name, id).catch(() => null)
            : null
          const session = await this.sessionManager.getSession(c.req.raw)
          await this.queryExecutor.delete(entity.name, id, { session })
          await this.triggerEntityWorkflows(entity.name, 'delete', existing || { id }, undefined)
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

  private async triggerEntityWorkflows(
    entity: string,
    event: 'create' | 'update' | 'delete',
    before: any,
    after: any
  ): Promise<void> {
    if (!this.workflowManager) {
      return
    }

    try {
      await this.workflowManager.triggerEntityEvent(entity, event, { before, after })
    } catch (error) {
      console.error(`Failed to trigger ${event} workflows for ${entity}:`, error)
    }
  }

  private registerSkillRoutes(): void {
    if (!this.blueprint.skills || this.blueprint.skills.length === 0) {
      return
    }

    const entityNames = new Set(this.blueprint.entities.map(e => e.name.toLowerCase()))

    for (const skill of this.blueprint.skills) {
      for (const action of skill.actions) {
        // Skip actions that map directly to standard CRUD routes
        if (this.isStandardCrudRoute(action, entityNames)) {
          continue
        }

        // Only register actions with entity+action or workflow annotations
        if (!action.entity && !action.workflow) {
          continue
        }

        // Convert {id} path syntax to Hono :id syntax
        const honoPath = action.path.replace(/\{(\w+)\}/g, ':$1')
        const method = action.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'

        this.app[method](honoPath, async (c) => {
          try {
            // Auth check — try API key first, then session
            const authHeader = c.req.header('authorization') || ''
            let session = null
            if (authHeader.toLowerCase().startsWith('bearer ')) {
              const token = authHeader.slice(7)
              session = this.resolveApiKeySession(token)
            }
            if (!session) {
              session = await this.sessionManager.getSession(c.req.raw)
            }
            if (skill.auth !== 'none' && !session) {
              return Response.json({ error: 'Unauthorized' }, { status: 401 })
            }

            if (action.workflow) {
              return await this.handleSkillWorkflow(c, action, session)
            }

            return await this.handleSkillEntityAction(c, action, session)
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

  private isStandardCrudRoute(action: SkillAction, entityNames: Set<string>): boolean {
    // Match paths like /api/{entity}s and /api/{entity}s/:id
    const match = action.path.match(/^\/api\/(\w+?)s(?:\/\{id\})?$/)
    if (!match) return false

    const pathEntity = match[1]?.toLowerCase()
    return !!pathEntity && entityNames.has(pathEntity)
  }

  private async handleSkillEntityAction(
    c: Context,
    action: SkillAction,
    session: any
  ): Promise<Response> {
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
        const result = await this.queryExecutor.create(entityName, body, { session })
        await this.triggerEntityWorkflows(entityName, 'create', undefined, result)
        return Response.json(result, { status: 201 })
      }

      case 'update': {
        const id = c.req.param('id')
        if (!id) {
          return Response.json({ error: 'Missing id parameter' }, { status: 400 })
        }
        const body = await c.req.json<Record<string, any>>()
        const before = this.workflowManager
          ? await this.queryExecutor.findById(entityName, id).catch(() => null)
          : null
        const result = await this.queryExecutor.update(entityName, id, body, { session })
        await this.triggerEntityWorkflows(entityName, 'update', before, result)
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
        const results = await this.queryExecutor.execute(
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
        const result = await this.queryExecutor.findById(entityName, id)
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
        const existing = this.workflowManager
          ? await this.queryExecutor.findById(entityName, id).catch(() => null)
          : null
        await this.queryExecutor.delete(entityName, id, { session })
        await this.triggerEntityWorkflows(entityName, 'delete', existing || { id }, undefined)
        return Response.json({ success: true })
      }

      default:
        return Response.json({ error: `Unknown action: ${action.action}` }, { status: 400 })
    }
  }

  private async handleSkillWorkflow(
    c: Context,
    action: SkillAction,
    session: any
  ): Promise<Response> {
    if (!this.workflowManager) {
      return Response.json({ error: 'Workflow engine not available' }, { status: 500 })
    }

    const workflowName = action.workflow!
    const workflow = this.workflowManager.getWorkflow(workflowName)
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
      record = await this.queryExecutor.findById(action.entity, params.id).catch(() => null)
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

    const job = this.workflowManager.trigger(workflowName, data)

    return Response.json({
      success: true,
      job: { id: job.id, workflow: workflowName },
    })
  }

  private registerOpenAPIRoute(): void {
    this.app.get('/api/openapi.json', async (c) => {
      const origin = this.resolveOrigin(c.req.raw)
      const spec = generateOpenAPISpec(this.blueprint, origin)
      return Response.json(spec, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',
        },
      })
    })
  }

  private registerPageRoutes(): void {
    this.app.all('*', async (c) => {
      return this.blueprintAdapter.handle(c.req.raw)
    })
  }

  private initApiKeys(): void {
    this.apiKeys.clear()
    const apiKeyConfigs = this.blueprint.auth?.apiKeys
    if (!apiKeyConfigs || apiKeyConfigs.length === 0) return

    for (const keyConfig of apiKeyConfigs) {
      const keyValue = process.env[keyConfig.keyEnv]
      if (!keyValue) {
        console.warn(`API key "${keyConfig.name}": env var ${keyConfig.keyEnv} is not set, skipping`)
        continue
      }
      this.apiKeys.set(keyValue, { name: keyConfig.name })
    }
  }

  private resolveApiKeySession(bearerToken: string): any | null {
    const keyConfig = this.apiKeys.get(bearerToken)
    if (!keyConfig) return null
    return {
      id: `apikey-${keyConfig.name}`,
      userId: keyConfig.name,
      user: { id: keyConfig.name, name: keyConfig.name, email: '' },
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
    }
  }

  private getHealthStatus(): { healthy: boolean; database: boolean; status: string; timestamp: string } {
    const databaseHealthy = !!this.queryExecutor
    const isHealthy = this.state.status === 'running' && databaseHealthy

    return {
      healthy: isHealthy,
      database: databaseHealthy,
      status: this.state.status,
      timestamp: new Date().toISOString()
    }
  }

  private getCallbackPath(request: Request): string {
    const url = new URL(request.url)
    const raw = url.searchParams.get('callback') || url.searchParams.get('redirect') || '/'
    try {
      const parsed = new URL(raw, 'http://localhost')
      const path = parsed.pathname + (parsed.search || '')
      return path.startsWith('/') ? path : `/${path}`
    } catch {
      return raw && raw.startsWith('/') ? raw : '/'
    }
  }

  private async parseActionRequestBody(c: Context): Promise<Record<string, any>> {
    const contentType = c.req.header('content-type') || ''

    if (contentType.includes('application/json')) {
      try {
        const parsed = await c.req.json<Record<string, any>>()
        return this.normalizeActionBody(parsed)
      } catch {
        return {}
      }
    }

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      try {
        const body = await c.req.parseBody()
        return this.normalizeActionBody(body as Record<string, any>)
      } catch {
        return {}
      }
    }

    return {}
  }

  private parseActionPayload(value: unknown): any {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    }

    return value
  }

  private normalizeActionBody(body: Record<string, any>): Record<string, any> {
    if (!body || typeof body !== 'object') return {}
    // Pass values through as-is. JSON bodies need no decoding, and
    // form-encoded bodies are already decoded by the framework.
    // Decoding HTML entities here would re-introduce XSS vectors
    // (e.g. &lt;script&gt; → <script>) if values reach templates.
    return { ...body }
  }

  private acceptsJson(c: Context): boolean {
    const accept = c.req.header('accept') || ''
    return accept.includes('application/json')
  }

  private resolveActionRedirect(provided?: string, referer?: string): string {
    if (provided && this.isSafeRedirect(provided)) {
      return provided
    }
    if (referer && this.isSafeRedirect(referer)) {
      return referer
    }
    return '/'
  }

  private isSafeRedirect(url: string): boolean {
    if (!url || url.length === 0) return false
    // Must be a relative path starting with a single slash.
    // Reject protocol-relative URLs (//evil.com), absolute URLs
    // (http://evil.com), and dangerous schemes (javascript:, data:).
    return url.startsWith('/') && !url.startsWith('//') && !url.includes('://')
  }

  private setFlashMessage(c: Context, message: string | undefined, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
    if (!message) {
      return
    }
    const payload = encodeURIComponent(JSON.stringify({ type, text: message }))
    c.header('Set-Cookie', `flash=${payload}; Path=/; HttpOnly; SameSite=Lax`)
  }

  private async extractCsrfToken(c: Context): Promise<string | undefined> {
    const urlToken = new URL(c.req.url).searchParams.get('_csrf')
    if (urlToken) {
      return urlToken
    }

    const contentType = c.req.header('content-type') || ''

    try {
      if (contentType.includes('application/json')) {
        const cloned = c.req.raw.clone()
        const body = await cloned.json().catch(() => undefined) as Record<string, any> | undefined
        if (body && typeof body._csrf === 'string') {
          return body._csrf
        }
      } else if (
        contentType.includes('application/x-www-form-urlencoded') ||
        contentType.includes('multipart/form-data')
      ) {
        const cloned = c.req.raw.clone()
        const form = await cloned.formData()
        const value = form.get('_csrf')
        if (typeof value === 'string') {
          return value
        }
        if (value && typeof value === 'object' && 'toString' in value) {
          return value.toString()
        }
      }
    } catch {
      return undefined
    }

    return undefined
  }

  private resolveOrigin(request: Request): string {
    const url = new URL(request.url)
    let host = url.host

    if (!host || host.startsWith('0.0.0.0') || host.startsWith('::')) {
      const fallbackHost = this.config.host && this.config.host !== '0.0.0.0' && this.config.host !== '::'
        ? this.config.host
        : 'localhost'
      const fallbackPort = this.config.port || 3000
      host = `${fallbackHost}:${fallbackPort}`
    }

    return `${url.protocol}//${host}`
  }

  private async tryParseBody(request: Request): Promise<any> {
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return request.json().catch(() => null)
    }
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      return Object.fromEntries(form as any)
    }
    return request.text()
  }

  private getClientIp(c: Context): string {
    const forwarded = c.req.header('x-forwarded-for')
    if (forwarded) {
      return forwarded.split(',')[0]?.trim() || 'unknown'
    }
    const socket = (c.env as any)?.incoming?.socket
    return socket?.remoteAddress || 'unknown'
  }

  private applyRateLimiting(c: Context): Response | void {
    const ip = this.getClientIp(c)
    const max = this.config.dev?.rateLimit?.max || 100
    const windowMs = this.config.dev?.rateLimit?.windowMs || 60_000
    const now = Date.now()
    const bucket = this.rateLimitStore.get(ip)

    if (!bucket || now > bucket.resetAt) {
      this.rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs })
      return
    }

    if (bucket.count >= max) {
      return Response.json(
        { error: 'Too Many Requests', retryAfter: Math.ceil((bucket.resetAt - now) / 1000) },
        { status: 429 }
      )
    }

    bucket.count += 1
  }

  private async applyCsrfProtection(c: Context): Promise<Response | void> {
    const pathname = new URL(c.req.url).pathname
    const isInboundEndpoint =
      pathname.startsWith('/webhooks/')
      || pathname.startsWith('/notifications/')
    if (isInboundEndpoint) {
      return
    }

    const method = c.req.method.toUpperCase()

    // Only skip CSRF for bearer tokens that resolve to a valid API key.
    // A garbage bearer token must NOT bypass CSRF, since skill routes fall
    // back to cookie-based session auth when the token is unrecognized.
    const authHeader = c.req.header('authorization') || ''
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7)
      if (this.apiKeys.has(token)) return
    }

    const isSafeMethod = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    const existingTokenRaw = getCookie(c, this.csrfCookieName)
    const existingToken = this.normalizeCsrfToken(existingTokenRaw)

    if (isSafeMethod) {
      const token = existingToken || randomUUID()
      Reflect.set(c.req.raw, '__zebricCsrfToken', token)
      if (!existingTokenRaw) {
        setCookie(c, this.csrfCookieName, token, {
          httpOnly: false,
          sameSite: 'strict',
          secure: false,
          path: '/'
        })
      }
      return
    }

    let submittedToken =
      c.req.raw.headers.get('x-csrf-token')
      || c.req.raw.headers.get('X-CSRF-Token')
      || c.req.header('x-csrf-token')
      || undefined
    if (!submittedToken) {
      submittedToken = await this.extractCsrfToken(c)
    }
    submittedToken = this.normalizeCsrfToken(submittedToken)

    if (!existingToken || !submittedToken || existingToken !== submittedToken) {
      const diagnostics = this.config.dev?.logLevel === 'debug'
        ? {
            method,
            path: new URL(c.req.url).pathname,
            hasCookieToken: Boolean(existingToken),
            hasSubmittedToken: Boolean(submittedToken),
            cookieTokenPreview: existingToken ? existingToken.slice(0, 8) : null,
            submittedTokenPreview: submittedToken ? submittedToken.slice(0, 8) : null
          }
        : undefined
      return Response.json(
        { error: 'Invalid CSRF token', diagnostics },
        { status: 403 }
      )
    }
  }

  private applySecurityHeaders(c: Context, requestId: string, traceId: string): void {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:"
    ].join('; ')

    c.header('X-Request-ID', requestId)
    c.header('X-Trace-ID', traceId)
    c.header('Content-Security-Policy', csp)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('X-XSS-Protection', '1; mode=block')
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  private normalizeCsrfToken(value: string | undefined): string | undefined {
    if (!value) {
      return undefined
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1)
    }
    return trimmed
  }

  private isUrlVerificationRequest(body: any): boolean {
    return Boolean(body && typeof body === 'object' && body.type === 'url_verification')
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }

    return mimeTypes[ext] || 'application/octet-stream'
  }
}
