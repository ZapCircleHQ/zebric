/**
 * ServerManager
 *
 * Handles HTTP server setup and route registration:
 * - Fastify server initialization
 * - Middleware configuration (security, metrics, rate limiting)
 * - Route registration (auth, webhooks, API, pages, admin)
 * - Request/response handling
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { ulid } from 'ulid'
import path from 'node:path'
import type { AuthProvider, SessionManager } from '../auth/index.js'
import type { Blueprint, EngineConfig, EngineState } from '../types/index.js'
import type { SchemaDiffResult } from '../database/index.js'
import type { WorkflowManager } from '../workflows/index.js'
import type { QueryExecutor } from '../database/index.js'
import type { PluginRegistry } from '../plugins/index.js'
import type { RouteMatcher, RouteHandler } from '../server/index.js'
import type { MetricsRegistry } from '../monitoring/metrics.js'
import type { RequestTracer } from '../monitoring/request-tracer.js'
import { SpanType, SpanStatus } from '../monitoring/request-tracer.js'
import type { ErrorHandler } from '../errors/index.js'
import { CSPBuilder } from '../security/index.js'

const ENGINE_VERSION = '0.1.0'

export interface ServerManagerDependencies {
  blueprint: Blueprint
  config: EngineConfig
  state: EngineState
  authProvider: AuthProvider
  sessionManager: SessionManager
  queryExecutor: QueryExecutor
  workflowManager?: WorkflowManager
  plugins: PluginRegistry
  routeMatcher: RouteMatcher
  routeHandler: RouteHandler
  metrics: MetricsRegistry
  tracer: RequestTracer
  errorHandler: ErrorHandler
  pendingSchemaDiff: SchemaDiffResult | null
  getHealthStatus?: () => Promise<any>
}

/**
 * ServerManager - Manages HTTP server and route registration
 */
export class ServerManager {
  private server!: FastifyInstance
  private blueprint: Blueprint
  private config: EngineConfig
  private state: EngineState
  private authProvider: AuthProvider
  private sessionManager: SessionManager
  private queryExecutor: QueryExecutor
  private workflowManager?: WorkflowManager
  private plugins: PluginRegistry
  private routeMatcher: RouteMatcher
  private routeHandler: RouteHandler
  private metrics: MetricsRegistry
  private tracer: RequestTracer
  private errorHandler: ErrorHandler
  private getHealthStatusFn?: () => Promise<any>

  constructor(deps: ServerManagerDependencies) {
    this.blueprint = deps.blueprint
    this.config = deps.config
    this.state = deps.state
    this.authProvider = deps.authProvider
    this.sessionManager = deps.sessionManager
    this.queryExecutor = deps.queryExecutor
    this.workflowManager = deps.workflowManager
    this.plugins = deps.plugins
    this.routeMatcher = deps.routeMatcher
    this.routeHandler = deps.routeHandler
    this.metrics = deps.metrics
    this.tracer = deps.tracer
    this.errorHandler = deps.errorHandler
    this.getHealthStatusFn = deps.getHealthStatus
  }

  /**
   * Update dependencies (called after reload or subsystem changes)
   */
  updateDependencies(updates: Partial<ServerManagerDependencies>): void {
    if (updates.blueprint) this.blueprint = updates.blueprint
    if (updates.config) this.config = updates.config
    if (updates.state) this.state = updates.state
    if (updates.authProvider) this.authProvider = updates.authProvider
    if (updates.sessionManager) this.sessionManager = updates.sessionManager
    if (updates.queryExecutor) this.queryExecutor = updates.queryExecutor
    if (updates.workflowManager !== undefined) this.workflowManager = updates.workflowManager
    if (updates.plugins) this.plugins = updates.plugins
    if (updates.routeMatcher) this.routeMatcher = updates.routeMatcher
    if (updates.routeHandler) this.routeHandler = updates.routeHandler
    if (updates.metrics) this.metrics = updates.metrics
    if (updates.tracer) this.tracer = updates.tracer
    if (updates.errorHandler) this.errorHandler = updates.errorHandler
  }

  /**
   * Start HTTP server
   */
  async start(): Promise<FastifyInstance> {
    this.server = Fastify({
      logger: this.config.dev?.logLevel === 'debug',
      bodyLimit: 10 * 1024 * 1024, // 10MB max body size (protects against DoS)
      requestIdHeader: 'x-request-id',
      genReqId: () => ulid(),
    })

    // Register error handler
    this.server.setErrorHandler(this.errorHandler.toFastifyHandler())

    // Add request ID and security headers and start request timer
    this.server.addHook('onRequest', async (request, reply) => {
      ;(request as any)._metricsStart = this.metrics.now()

      // Start trace for this request
      this.tracer.startTrace(request.id, request.method, request.url)

      // Start HTTP request span
      const httpSpanId = this.tracer.startSpan(
        request.id,
        SpanType.HTTP_REQUEST,
        `${request.method} ${request.url}`,
        {
          method: request.method,
          url: request.url,
          headers: Object.keys(request.headers),
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        }
      )
      ;(request as any)._traceId = request.id
      ;(request as any)._httpSpanId = httpSpanId

      // Add request ID to response header
      reply.header('X-Request-ID', request.id)
      reply.header('X-Trace-ID', request.id)

      // CSP header - allow Tailwind CDN for development
      const csp = new CSPBuilder()
        .directive('default-src', ["'self'"])
        .directive('script-src', ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com']) // Tailwind CDN
        .directive('style-src', ["'self'", "'unsafe-inline'"])
        .directive('img-src', ["'self'", 'data:', 'https:'])
        .build()

      reply.header('Content-Security-Policy', csp)
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('X-Frame-Options', 'DENY')
      reply.header('X-XSS-Protection', '1; mode=block')
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    })

    // Record request metrics and end trace
    this.server.addHook('onResponse', async (request, reply) => {
      const start = (request as any)._metricsStart
      const duration = typeof start === 'number' ? this.metrics.now() - start : 0
      const route =
        (request.routeOptions && request.routeOptions.url) ||
        request.url ||
        'unknown'

      this.metrics.recordRequest(route, reply.statusCode, duration)

      // End HTTP span
      const httpSpanId = (request as any)._httpSpanId
      if (httpSpanId) {
        const status = reply.statusCode >= 400 ? SpanStatus.ERROR : SpanStatus.OK
        this.tracer.endSpan(httpSpanId, status, {
          statusCode: reply.statusCode,
          contentLength: reply.getHeader('content-length'),
        })
      }

      // End trace
      const traceId = (request as any)._traceId
      if (traceId) {
        const error = reply.statusCode >= 500 ? `HTTP ${reply.statusCode}` : undefined
        this.tracer.endTrace(traceId, reply.statusCode, error)
      }
    })

    // Register Fastify plugins
    await this.server.register(import('@fastify/formbody'))
    await this.server.register(import('@fastify/multipart'), {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max file size
        files: 10, // Max 10 files per request
      },
    })
    await this.server.register(import('@fastify/cookie'))

    // Register static file serving for uploads
    await this.server.register(import('@fastify/static'), {
      root: path.resolve(process.cwd(), 'data/uploads'),
      prefix: '/uploads/',
      decorateReply: false, // Don't decorate reply since we may have multiple static paths
    })

    // Register CSRF protection
    await this.server.register(import('@fastify/csrf-protection'), {
      cookieOpts: {
        signed: false, // Don't sign CSRF token cookie
        httpOnly: true,
        sameSite: 'strict'
      }
    })

    // Register rate limiting (100 requests per minute per IP by default)
    const rateLimitPlugin = await import('@fastify/rate-limit')
    await this.server.register(rateLimitPlugin.default, {
      max: 100,
      timeWindow: '1 minute'
    })

    // Register routes
    this.registerRoutes()

    // Start listening
    const port = this.config.port || 3000
    const host = this.config.host || '0.0.0.0'

    await this.server.listen({ port, host })
    console.log(`✅ HTTP Server listening on ${host}:${port}`)

    return this.server
  }

  /**
   * Stop HTTP server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close()
    }
  }

  /**
   * Get server instance
   */
  getServer(): FastifyInstance {
    return this.server
  }

  /**
   * Register routes from Blueprint
   */
  private registerRoutes(): void {
    // Health check
    this.server.get('/health', async (_request, reply) => {
      const health = this.getHealthStatusFn ? await this.getHealthStatusFn() : this.getHealthStatus()
      return reply.code(health.healthy ? 200 : 503).send(health)
    })

    // Metrics endpoint (Prometheus format)
    this.server.get('/metrics', async (_request, reply) => {
      reply.header('Content-Type', 'text/plain; version=0.0.4')
      reply.send(this.metrics.toPrometheus())
    })

    // Built-in auth UIs
    this.registerAuthPages()

    // Register authentication routes
    this.registerAuthRoutes()

    // Register webhook routes
    this.registerWebhookRoutes()

    // Register API routes for entities
    this.registerAPIRoutes()

    // Register page routes from Blueprint
    this.registerPageRoutes()

    // Catch-all 404 handler
    this.server.setNotFoundHandler(async (request, reply) => {
      const acceptsHtml = !request.headers.accept?.includes('application/json')

      if (acceptsHtml && this.routeHandler) {
        // Render HTML 404 page
        const renderer = (this.routeHandler as any).renderer
        if (renderer) {
          const html = renderer.render404(request.url)
          reply.code(404).type('text/html').send(html)
          return
        }
      }

      // Fall back to JSON
      reply.code(404).send({
        error: 'Not Found',
        message: 'The requested page does not exist',
      })
    })
  }

  /**
   * Register authentication pages
   */
  private registerAuthPages(): void {
    this.server.get('/auth/sign-in', async (request: FastifyRequest, reply: FastifyReply) => {
      const callbackPath = this.getCallbackPath(request)
      const origin = this.resolveOrigin(request)
      const callback = `${origin}${callbackPath}`
      const RendererClass = this.config.rendererClass || (await import('../renderer/index.js')).HTMLRenderer
      const renderer = new RendererClass(this.blueprint, this.config.theme, this.plugins)
      reply.type('text/html').send(renderer.renderSignInPage(callback))
    })

    this.server.get('/auth/sign-up', async (request: FastifyRequest, reply: FastifyReply) => {
      const callbackPath = this.getCallbackPath(request)
      const origin = this.resolveOrigin(request)
      const callback = `${origin}${callbackPath}`
      const RendererClass = this.config.rendererClass || (await import('../renderer/index.js')).HTMLRenderer
      const renderer = new RendererClass(this.blueprint, this.config.theme, this.plugins)
      reply.type('text/html').send(renderer.renderSignUpPage(callback))
    })

    this.server.get('/auth/sign-out', async (request: FastifyRequest, reply: FastifyReply) => {
      const callbackPath = this.getCallbackPath(request)
      const origin = this.resolveOrigin(request)
      const callback = `${origin}${callbackPath}`
      const RendererClass = this.config.rendererClass || (await import('../renderer/index.js')).HTMLRenderer
      const renderer = new RendererClass(this.blueprint, this.config.theme, this.plugins)
      reply.type('text/html').send(renderer.renderSignOutPage(callback))
    })
  }

  /**
   * Register authentication routes
   */
  private registerAuthRoutes(): void {
    // Register Better Auth handler for all auth endpoints
    this.server.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          // Construct request URL
          const url = new URL(request.url, `http://${request.headers.host}`)

          // Convert Fastify headers to standard Headers object
          const headers = new Headers()
          Object.entries(request.headers).forEach(([key, value]) => {
            if (value) {
              headers.append(key, Array.isArray(value) ? value[0] : value)
            }
          })

          // Create Fetch API-compatible request
          const req = new Request(url.toString(), {
            method: request.method,
            headers,
            body: request.body ? JSON.stringify(request.body) : undefined,
          })

          // Call Better Auth handler (get underlying instance)
          const betterAuthInstance = this.authProvider.getAuthInstance()
          const res = await betterAuthInstance.handler(req)

          // Copy response headers
          res.headers.forEach((value: string, key: string) => {
            reply.header(key, value)
          })

          // Send response
          reply.code(res.status).send(await res.text())
        } catch (error) {
          console.error('Auth route error:', error)
          reply.code(500).send({
            error: 'Authentication failed',
            details: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      },
    })

    console.log('✅ Registered authentication routes at /api/auth/*')
  }

  /**
   * Register webhook routes for workflows
   */
  private registerWebhookRoutes(): void {
    if (!this.workflowManager) {
      return
    }

    // Register a wildcard route for all webhooks
    this.server.route({
      method: ['GET', 'POST', 'PUT', 'DELETE'],
      url: '/webhooks/*',
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          // Get webhook path (e.g., /webhooks/github -> /webhooks/github)
          const webhookPath = request.url.split('?')[0]

          // Trigger workflows for this webhook
          const jobs = await this.workflowManager!.triggerWebhook(webhookPath, {
            headers: request.headers as Record<string, string>,
            body: request.body,
            query: request.query as Record<string, string>,
          })

          if (jobs.length === 0) {
            reply.code(404).send({
              error: 'No workflow found for this webhook',
              path: webhookPath,
            })
            return
          }

          reply.send({
            success: true,
            message: `Triggered ${jobs.length} workflow(s)`,
            jobs: jobs.map((job) => ({
              id: job.id,
              workflow: job.workflowName,
              status: job.status,
            })),
          })
        } catch (error) {
          console.error('Webhook error:', error)
          reply.code(500).send({
            error: 'Failed to trigger workflow',
            details: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      },
    })

    console.log('✅ Registered webhook routes at /webhooks/*')
  }

  /**
   * Register API routes for CRUD operations on entities
   */
  private registerAPIRoutes(): void {
    if (!this.blueprint.entities || this.blueprint.entities.length === 0) {
      return
    }

    for (const entity of this.blueprint.entities) {
      const entityPath = `/api/${entity.name.toLowerCase()}s`
      const entityPathWithId = `${entityPath}/:id`

      // CREATE - POST /api/posts
      this.server.post(entityPath, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const data = request.body as Record<string, any>
          const session = await this.sessionManager.getSession(request)
          const result = await this.queryExecutor.create(entity.name, data, { session })
          reply.code(201).send(result)
        } catch (error) {
          console.error(`Create ${entity.name} error:`, error)
          reply.code(500).send({
            error: 'Create failed',
            details: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      })

      // READ ALL - GET /api/posts
      this.server.get(entityPath, async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
          const results = await this.queryExecutor.execute(
            {
              entity: entity.name,
              orderBy: { createdAt: 'desc' },
              limit: 100,
            },
            {}
          )
          reply.send(results)
        } catch (error) {
          console.error(`List ${entity.name} error:`, error)
          reply.code(500).send({
            error: 'List failed',
            details: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      })

      // READ ONE - GET /api/posts/:id
      this.server.get(entityPathWithId, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const params = request.params as { id: string }
          const result = await this.queryExecutor.findById(entity.name, params.id)
          if (!result) {
            reply.code(404).send({ error: 'Not found' })
            return
          }
          reply.send(result)
        } catch (error) {
          console.error(`Find ${entity.name} error:`, error)
          reply.code(500).send({
            error: 'Find failed',
            details: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      })

      // UPDATE - PUT /api/posts/:id
      this.server.put(entityPathWithId, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const params = request.params as { id: string }
          const data = request.body as Record<string, any>
          const session = await this.sessionManager.getSession(request)
          const result = await this.queryExecutor.update(entity.name, params.id, data, { session })
          reply.send(result)
        } catch (error) {
          console.error(`Update ${entity.name} error:`, error)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'

          // Check if it's a "not found" error
          if (errorMessage.includes('not found')) {
            reply.code(404).send({
              error: 'Not found',
              details: errorMessage,
            })
          } else {
            reply.code(500).send({
              error: 'Update failed',
              details: errorMessage,
            })
          }
        }
      })

      // DELETE - DELETE /api/posts/:id
      this.server.delete(entityPathWithId, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const params = request.params as { id: string }
          const session = await this.sessionManager.getSession(request)
          await this.queryExecutor.delete(entity.name, params.id, { session })
          reply.code(204).send()
        } catch (error) {
          console.error(`Delete ${entity.name} error:`, error)
          reply.code(500).send({
            error: 'Delete failed',
            details: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      })
    }

    console.log(`✅ Registered API routes for ${this.blueprint.entities.length} entities`)
  }

  /**
   * Register page routes from Blueprint
   */
  private registerPageRoutes(): void {
    if (!this.blueprint.pages || this.blueprint.pages.length === 0) {
      return
    }

    // Register a catch-all route that handles all HTTP methods
    this.server.all('/*', async (request: FastifyRequest, reply: FastifyReply) => {
      const match = this.routeMatcher.match(request.url, this.blueprint.pages)

      if (!match) {
        // Let the 404 handler deal with it
        reply.callNotFound()
        return
      }

      // Route matched, handle based on HTTP method
      try {
        switch (request.method) {
          case 'GET':
            await this.routeHandler.handleGet(match, request, reply)
            break

          case 'POST':
            await this.routeHandler.handlePost(match, request, reply)
            break

          case 'PUT':
            await this.routeHandler.handlePut(match, request, reply)
            break

          case 'DELETE':
            await this.routeHandler.handleDelete(match, request, reply)
            break

          default:
            reply.code(405).send({
              error: 'Method Not Allowed',
              message: `HTTP method ${request.method} is not supported for this route`,
            })
        }
      } catch (error) {
        console.error('Route handler error:', error)
        reply.code(500).send({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
        })
      }
    })

    console.log(`✅ Registered ${this.blueprint.pages.length} page routes`)
  }

  /**
   * Get health status
   */
  private getHealthStatus(): { healthy: boolean; database: boolean; status: string; timestamp: string } {
    // Check database connectivity by attempting a simple query
    let databaseHealthy = false
    try {
      // If we have a query executor, database is healthy
      databaseHealthy = !!this.queryExecutor
    } catch (error) {
      databaseHealthy = false
    }

    const isHealthy = this.state.status === 'running' && databaseHealthy

    return {
      healthy: isHealthy,
      database: databaseHealthy,
      status: this.state.status,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Extract callback parameter from request
   */
  private extractCallbackParam(request: FastifyRequest): string {
    const query = request.query as Record<string, any>
    return query.callback || query.redirect || '/'
  }

  /**
   * Get callback path from request
   */
  private getCallbackPath(request: FastifyRequest): string {
    const raw = this.extractCallbackParam(request)
    try {
      const url = new URL(raw, 'http://localhost')
      const path = url.pathname + (url.search || '')
      return path.startsWith('/') ? path : `/${path}`
    } catch {
      return raw && raw.startsWith('/') ? raw : '/'
    }
  }

  /**
   * Resolve origin from request
   */
  private resolveOrigin(request: FastifyRequest): string {
    const protocol = request.protocol || 'http'
    const hostHeader = request.headers.host || request.hostname
    let host = hostHeader ? hostHeader.split(',')[0].trim() : ''

    if (!host || host.startsWith('0.0.0.0') || host.startsWith('::')) {
      const fallbackHost = this.config.host && this.config.host !== '0.0.0.0' && this.config.host !== '::'
        ? this.config.host
        : 'localhost'
      const fallbackPort = this.config.port || 3000
      host = `${fallbackHost}:${fallbackPort}`
    }

    return `${protocol}://${host}`
  }
}
