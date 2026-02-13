import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve, type ServerType } from '@hono/node-server'
import { getCookie, setCookie } from 'hono/cookie'
import { ulid } from 'ulid'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AuthProvider, SessionManager } from '@zebric/runtime-core'
import type { Blueprint } from '@zebric/runtime-core'
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
  private rateLimitStore = new Map<string, { count: number; resetAt: number }>()
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
    if (updates.getHealthStatus) this.getHealthStatusFn = updates.getHealthStatus
  }

  async start(): Promise<ServerType> {
    this.app = new Hono()
    this.app.onError(this.errorHandler.toHonoHandler())
    this.registerGlobalMiddleware()
    this.registerRoutes()

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
    this.registerActionRoutes()
    this.registerAPIRoutes()
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

  private registerStaticUploads(): void {
    const root = path.resolve(process.cwd(), 'data/uploads')
    this.app.get('/uploads/*', async (c) => {
      const relative = c.req.path.replace(/^\/uploads\/?/, '')
      const filePath = path.join(root, relative)
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
        const pagePath = typeof body.page === 'string' ? body.page : undefined
        const sourcePage = pagePath
          ? this.blueprint.pages.find((page) => page.path === pagePath)
          : undefined
        const authRequired = sourcePage
          ? sourcePage.auth !== 'none' && sourcePage.auth !== 'optional'
          : true

        const session = await this.sessionManager.getSession(c.req.raw)
        if (authRequired && !session) {
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

      this.app.get(entityPath, async () => {
        try {
          const results = await this.queryExecutor.execute(
            {
              entity: entity.name,
              orderBy: { createdAt: 'desc' },
              limit: 100
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

  private registerPageRoutes(): void {
    this.app.all('*', async (c) => {
      return this.blueprintAdapter.handle(c.req.raw)
    })
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
    const normalized: Record<string, any> = {}
    for (const [key, value] of Object.entries(body || {})) {
      if (typeof value === 'string') {
        normalized[key] = this.decodeHtmlEntities(value)
      } else {
        normalized[key] = value
      }
    }
    return normalized
  }

  private decodeHtmlEntities(input: string): string {
    if (!input || !input.includes('&')) {
      return input
    }

    return input
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
        const code = Number.parseInt(hex, 16)
        return Number.isFinite(code) ? String.fromCharCode(code) : _m
      })
      .replace(/&#([0-9]+);/g, (_m, dec) => {
        const code = Number.parseInt(dec, 10)
        return Number.isFinite(code) ? String.fromCharCode(code) : _m
      })
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }

  private acceptsJson(c: Context): boolean {
    const accept = c.req.header('accept') || ''
    return accept.includes('application/json')
  }

  private resolveActionRedirect(provided?: string, referer?: string): string {
    if (provided && provided.length > 0) {
      return provided
    }
    if (referer && referer.length > 0) {
      return referer
    }
    return '/'
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
    const method = c.req.method.toUpperCase()
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

    // Self-heal missing/stale cookie when request provides a valid token.
    if (!existingToken && submittedToken) {
      setCookie(c, this.csrfCookieName, submittedToken, {
        httpOnly: false,
        sameSite: 'strict',
        secure: false,
        path: '/'
      })
      return
    }

    // If cookie drifted but request token is present, rotate cookie to submitted token.
    if (existingToken && submittedToken && existingToken !== submittedToken) {
      setCookie(c, this.csrfCookieName, submittedToken, {
        httpOnly: false,
        sameSite: 'strict',
        secure: false,
        path: '/'
      })
      return
    }

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
