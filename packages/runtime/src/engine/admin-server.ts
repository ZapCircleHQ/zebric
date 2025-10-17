/**
 * AdminServer
 *
 * Separate HTTP server for admin/debugging endpoints.
 * Runs on a different port than the main application server for security.
 */

import Fastify, { FastifyInstance } from 'fastify'
import type { Blueprint, EngineState } from '../types/index.js'
import type { PluginRegistry } from '../plugins/index.js'
import type { RequestTracer } from '../monitoring/request-tracer.js'
import type { MetricsRegistry } from '../monitoring/metrics.js'
import type { SchemaDiffResult } from '../database/index.js'

export interface AdminServerDependencies {
  blueprint: Blueprint
  state: EngineState
  plugins: PluginRegistry
  tracer: RequestTracer
  metrics: MetricsRegistry
  pendingSchemaDiff: SchemaDiffResult | null
  getHealthStatus?: () => Promise<any>
  host?: string
  port?: number
}

/**
 * AdminServer - Separate server for admin and debugging endpoints
 */
export class AdminServer {
  private server!: FastifyInstance
  private blueprint: Blueprint
  private state: EngineState
  private plugins: PluginRegistry
  private tracer: RequestTracer
  private metrics: MetricsRegistry
  private pendingSchemaDiff: SchemaDiffResult | null
  private getHealthStatusFn?: () => Promise<any>
  private host: string
  private port: number

  constructor(deps: AdminServerDependencies) {
    this.blueprint = deps.blueprint
    this.state = deps.state
    this.plugins = deps.plugins
    this.tracer = deps.tracer
    this.metrics = deps.metrics
    this.pendingSchemaDiff = deps.pendingSchemaDiff
    this.getHealthStatusFn = deps.getHealthStatus
    this.host = deps.host || '127.0.0.1' // Bind to localhost only by default
    this.port = deps.port !== undefined ? deps.port : 3030
  }

  /**
   * Update dependencies (called after reload or subsystem changes)
   */
  updateDependencies(updates: Partial<AdminServerDependencies>): void {
    if (updates.blueprint) this.blueprint = updates.blueprint
    if (updates.state) this.state = updates.state
    if (updates.plugins) this.plugins = updates.plugins
    if (updates.tracer) this.tracer = updates.tracer
    if (updates.metrics) this.metrics = updates.metrics
    if (updates.pendingSchemaDiff !== undefined) this.pendingSchemaDiff = updates.pendingSchemaDiff
  }

  /**
   * Start admin server
   */
  async start(): Promise<FastifyInstance> {
    this.server = Fastify({
      logger: false,
    })

    // Security: No CORS, no authentication - should only be accessible from localhost
    // If you need to access from another machine, use SSH tunneling

    this.registerRoutes()

    await this.server.listen({ port: this.port, host: this.host })

    // Get the actual port (important when port is 0 for random assignment)
    const address = this.server.server.address()
    const actualPort = address && typeof address === 'object' ? address.port : this.port
    console.log(`📊 Admin Server listening on ${this.host}:${actualPort}`)

    return this.server
  }

  /**
   * Stop admin server
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
   * Register admin routes
   */
  private registerRoutes(): void {
    // Root - Admin dashboard info
    this.server.get('/', async () => {
      return {
        name: 'Zebric Admin Server',
        version: '0.1.0',
        endpoints: {
          blueprint: '/blueprint',
          state: '/state',
          schemaDiff: '/schema-diff',
          plugins: '/plugins',
          entities: '/entities',
          pages: '/pages',
          traces: {
            all: '/traces',
            byId: '/traces/:traceId',
            errors: '/traces/errors',
            slow: '/traces/slow',
            stats: '/traces/stats',
            clear: 'DELETE /traces',
          },
          metrics: '/metrics',
          health: '/health',
        },
      }
    })

    // Blueprint viewer
    this.server.get('/blueprint', async () => {
      return this.blueprint
    })

    // Engine state
    this.server.get('/state', async () => {
      return this.state
    })

    // Pending schema diff (if any)
    this.server.get('/schema-diff', async () => {
      return this.pendingSchemaDiff
    })

    // Plugins
    this.server.get('/plugins', async () => {
      return this.plugins.list().map((p) => ({
        name: p.definition.name,
        version: p.plugin.version,
        provides: p.plugin.provides,
        enabled: p.definition.enabled,
      }))
    })

    // Entities
    this.server.get('/entities', async () => {
      return this.blueprint.entities.map((e) => ({
        name: e.name,
        fields: e.fields.length,
        relations: Object.keys(e.relations || {}).length,
      }))
    })

    // Pages
    this.server.get('/pages', async () => {
      return this.blueprint.pages.map((p) => ({
        path: p.path,
        title: p.title,
        layout: p.layout,
        auth: p.auth,
      }))
    })

    // Traces - Get all recent traces
    this.server.get('/traces', async (request) => {
      const query = request.query as { limit?: string }
      const limit = query.limit ? parseInt(query.limit) : 100
      return this.tracer.getAllTraces(limit)
    })

    // Traces - Get specific trace by ID
    this.server.get('/traces/:traceId', async (request, reply) => {
      const params = request.params as { traceId: string }
      const trace = this.tracer.getTrace(params.traceId)
      if (!trace) {
        return reply.code(404).send({ error: 'Trace not found' })
      }
      return trace
    })

    // Traces - Get error traces
    this.server.get('/traces/errors', async (request) => {
      const query = request.query as { limit?: string }
      const limit = query.limit ? parseInt(query.limit) : 100
      return this.tracer.getErrorTraces(limit)
    })

    // Traces - Get slow traces
    this.server.get('/traces/slow', async (request) => {
      const query = request.query as { threshold?: string; limit?: string }
      const threshold = query.threshold ? parseInt(query.threshold) : 1000
      const limit = query.limit ? parseInt(query.limit) : 100
      return this.tracer.getSlowTraces(threshold, limit)
    })

    // Traces - Get trace statistics
    this.server.get('/traces/stats', async () => {
      return this.tracer.getStats()
    })

    // Traces - Clear all traces
    this.server.delete('/traces', async () => {
      this.tracer.clearTraces()
      return { message: 'All traces cleared' }
    })

    // Metrics (Prometheus format)
    this.server.get('/metrics', async (_request, reply) => {
      reply.header('Content-Type', 'text/plain; version=0.0.4')
      reply.send(this.metrics.toPrometheus())
    })

    // Health check
    this.server.get('/health', async (_request, reply) => {
      const health = this.getHealthStatusFn
        ? await this.getHealthStatusFn()
        : { healthy: true, status: 'running', timestamp: new Date().toISOString() }
      return reply.code(health.healthy ? 200 : 503).send(health)
    })
  }
}
