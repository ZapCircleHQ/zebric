import { Hono } from 'hono'
import { serve, type ServerType } from '@hono/node-server'
import { ulid } from 'ulid'
import type { NotificationManager } from '@zebric/notifications'
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
import {
  getClientIp,
  applyRateLimiting,
  applyCsrfProtection,
  applySecurityHeaders,
  initApiKeys,
} from './server-security.js'
import {
  registerStaticUploads,
  registerAuthPages,
  registerAuthRoutes,
  registerWebhookRoutes,
  registerNotificationRoutes,
  registerActionRoutes,
  registerSkillRoutes,
  registerAPIRoutes,
  registerOpenAPIRoute,
  registerPageRoutes,
} from './server-routes.js'

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
    this.apiKeys = initApiKeys(this.blueprint)
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
          ip: getClientIp(c),
          userAgent: c.req.header('user-agent')
        }
      )

      const rateLimitResponse = applyRateLimiting(c, this.rateLimitStore, {
        max: this.config.dev?.rateLimit?.max,
        windowMs: this.config.dev?.rateLimit?.windowMs,
      })
      if (rateLimitResponse) {
        return rateLimitResponse
      }

      const csrfResponse = await applyCsrfProtection(c, this.csrfCookieName, this.apiKeys, this.config.dev)
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

        applySecurityHeaders(c, requestId, traceId)
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

    registerStaticUploads(this.app)
    registerAuthPages(this.app, this.blueprint, this.config)
    registerAuthRoutes(this.app, this.authProvider)
    registerWebhookRoutes(this.app, this.workflowManager)
    registerNotificationRoutes(this.app, this.notificationManager, this.workflowManager)
    registerActionRoutes(this.app, {
      sessionManager: this.sessionManager,
      queryExecutor: this.queryExecutor,
      workflowManager: this.workflowManager,
    })
    registerSkillRoutes(this.app, {
      blueprint: this.blueprint,
      sessionManager: this.sessionManager,
      queryExecutor: this.queryExecutor,
      workflowManager: this.workflowManager,
      apiKeys: this.apiKeys,
    })
    registerAPIRoutes(this.app, {
      blueprint: this.blueprint,
      sessionManager: this.sessionManager,
      queryExecutor: this.queryExecutor,
      workflowManager: this.workflowManager,
    })
    registerOpenAPIRoute(this.app, this.blueprint, this.config)
    registerPageRoutes(this.app, this.blueprintAdapter)

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
}
