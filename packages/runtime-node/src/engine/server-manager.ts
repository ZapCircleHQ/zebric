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

      const csrfResponse = this.applyCsrfProtection(c)
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
          const session = await this.sessionManager.getSession(c.req.raw)
          const result = await this.queryExecutor.update(entity.name, id, data, { session })
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
          const session = await this.sessionManager.getSession(c.req.raw)
          await this.queryExecutor.delete(entity.name, id, { session })
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

  private applyCsrfProtection(c: Context): Response | void {
    const method = c.req.method.toUpperCase()
    const isSafeMethod = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    const existingToken = getCookie(c, this.csrfCookieName)

    if (isSafeMethod) {
      if (!existingToken) {
        setCookie(c, this.csrfCookieName, randomUUID(), {
          httpOnly: false,
          sameSite: 'strict',
          secure: false,
          path: '/'
        })
      }
      return
    }

    const headerToken = c.req.header('x-csrf-token')
    if (!existingToken || !headerToken || existingToken !== headerToken) {
      return Response.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      )
    }
  }

  private applySecurityHeaders(c: Context, requestId: string, traceId: string): void {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
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
