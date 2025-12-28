import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve, type ServerType } from '@hono/node-server'
import type { Blueprint } from '@zebric/runtime-core'
import type { EngineState } from '../types/index.js'
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

export class AdminServer {
  private app!: Hono
  private server?: ServerType
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
    this.host = deps.host || '127.0.0.1'
    this.port = deps.port !== undefined ? deps.port : 3030
  }

  updateDependencies(updates: Partial<AdminServerDependencies>): void {
    if (updates.blueprint) this.blueprint = updates.blueprint
    if (updates.state) this.state = updates.state
    if (updates.plugins) this.plugins = updates.plugins
    if (updates.tracer) this.tracer = updates.tracer
    if (updates.metrics) this.metrics = updates.metrics
    if (updates.pendingSchemaDiff !== undefined) this.pendingSchemaDiff = updates.pendingSchemaDiff
    if (updates.getHealthStatus) this.getHealthStatusFn = updates.getHealthStatus
  }

  async start(): Promise<ServerType> {
    this.app = new Hono()
    this.registerRoutes()

    this.server = serve({
      fetch: this.app.fetch,
      hostname: this.host,
      port: this.port
    }, () => {
      console.log(`📊 Admin Server listening on ${this.host}:${this.port}`)
    })

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

  private registerRoutes(): void {
    this.app.get('/', () => {
      return Response.json({
        name: 'Zebric Admin Server',
        version: '0.1.1',
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
      })
    })

    this.app.get('/blueprint', () => Response.json(this.blueprint))
    this.app.get('/state', () => Response.json(this.state))
    this.app.get('/schema-diff', () => Response.json(this.pendingSchemaDiff))

    this.app.get('/plugins', () => {
      const plugins = this.plugins.list().map((p) => ({
        name: p.definition.name,
        version: p.plugin.version,
        provides: p.plugin.provides,
        enabled: p.definition.enabled,
      }))
      return Response.json(plugins)
    })

    this.app.get('/entities', () => {
      const entities = this.blueprint.entities.map((e) => ({
        name: e.name,
        fields: e.fields.length,
        relations: Object.keys(e.relations || {}).length,
      }))
      return Response.json(entities)
    })

    this.app.get('/pages', () => {
      const pages = this.blueprint.pages.map((p) => ({
        path: p.path,
        title: p.title,
        layout: p.layout,
        auth: p.auth,
      }))
      return Response.json(pages)
    })

    this.app.get('/traces', (c) => {
      const limit = parseInt(c.req.query('limit') || '100', 10)
      return Response.json(this.tracer.getAllTraces(limit))
    })

    this.app.get('/traces/:traceId', (c) => {
      const trace = this.tracer.getTrace(c.req.param('traceId'))
      if (!trace) {
        return Response.json({ error: 'Trace not found' }, { status: 404 })
      }
      return Response.json(trace)
    })

    this.app.get('/traces/errors', (c) => {
      const limit = parseInt(c.req.query('limit') || '100', 10)
      return Response.json(this.tracer.getErrorTraces(limit))
    })

    this.app.get('/traces/slow', (c) => {
      const threshold = parseInt(c.req.query('threshold') || '1000', 10)
      const limit = parseInt(c.req.query('limit') || '100', 10)
      return Response.json(this.tracer.getSlowTraces(threshold, limit))
    })

    this.app.get('/traces/stats', () => {
      return Response.json(this.tracer.getStats())
    })

    this.app.delete('/traces', () => {
      this.tracer.clearTraces()
      return Response.json({ success: true, message: 'Traces cleared' })
    })

    this.app.get('/metrics', () => {
      return new Response(this.metrics.toPrometheus(), {
        status: 200,
        headers: { 'Content-Type': 'text/plain; version=0.0.4' }
      })
    })

    this.app.get('/health', async () => {
      const health = this.getHealthStatusFn ? await this.getHealthStatusFn() : { healthy: true }
      return Response.json(health, { status: health.healthy ? 200 : 503 })
    })
  }
}
