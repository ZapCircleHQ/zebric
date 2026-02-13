import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve, type ServerType } from '@hono/node-server'
import type { Blueprint } from '@zebric/runtime-core'
import type { EngineState } from '../types/index.js'
import type { PluginRegistry } from '../plugins/index.js'
import type { RequestTracer } from '../monitoring/request-tracer.js'
import type { MetricsRegistry } from '../monitoring/metrics.js'
import type { SchemaDiffResult } from '../database/index.js'
import type { WorkflowManager } from '../workflows/index.js'

export interface AdminServerDependencies {
  blueprint: Blueprint
  state: EngineState
  plugins: PluginRegistry
  tracer: RequestTracer
  metrics: MetricsRegistry
  pendingSchemaDiff: SchemaDiffResult | null
  workflowManager?: WorkflowManager
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
  private workflowManager?: WorkflowManager
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
    this.workflowManager = deps.workflowManager
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
    if (updates.workflowManager !== undefined) this.workflowManager = updates.workflowManager
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
          workflows: '/workflows',
          workflowVisualization: '/workflows/visualization',
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

    this.app.get('/workflows', () => {
      const workflows = this.workflowManager?.getAllWorkflows() || this.blueprint.workflows || []
      const jobs = this.workflowManager?.getJobs() || []
      const stats = this.workflowManager?.getStats()
      const workflowNames = new Set(workflows.map((workflow) => workflow.name))

      const byWorkflow = Array.from(workflowNames).map((name) => ({
        name,
        jobs: jobs.filter((job) => job.workflowName === name).length,
        pending: jobs.filter((job) => job.workflowName === name && job.status === 'pending').length,
        running: jobs.filter((job) => job.workflowName === name && job.status === 'running').length,
        failed: jobs.filter((job) => job.workflowName === name && job.status === 'failed').length,
      }))

      return Response.json({
        total: workflows.length,
        stats: stats || null,
        workflows: workflows.map((workflow) => ({
          name: workflow.name,
          description: (workflow as any).description,
          trigger: workflow.trigger,
          steps: workflow.steps.map((step, index) => ({
            index,
            type: step.type,
            entity: step.entity,
            action: step.action,
            adapter: step.adapter,
            assignTo: step.assignTo,
          })),
        })),
        jobsByWorkflow: byWorkflow,
      })
    })

    this.app.get('/workflows/visualization', (c) => {
      const selectedName = c.req.query('name')
      const workflows = this.workflowManager?.getAllWorkflows() || this.blueprint.workflows || []
      const selected = selectedName
        ? workflows.filter((workflow) => workflow.name === selectedName)
        : workflows

      const sections = selected.map((workflow) => {
        const svg = this.renderWorkflowSvg(workflow)
        const description = (workflow as any).description as string | undefined
        const triggerSummary = this.escapeHtml(JSON.stringify(workflow.trigger))
        return `
          <section class="card">
            <h2>${this.escapeHtml(workflow.name)}</h2>
            ${description ? `<p class="muted">${this.escapeHtml(description)}</p>` : ''}
            <p class="mono">trigger: ${triggerSummary}</p>
            <div class="graph">${svg}</div>
          </section>
        `
      }).join('\n')

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Workflow Visualization</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
    header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; background: #fff; position: sticky; top: 0; }
    main { padding: 20px; max-width: 1200px; margin: 0 auto; display: grid; gap: 16px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
    h1 { margin: 0; font-size: 20px; }
    h2 { margin: 0 0 8px; font-size: 18px; }
    .muted { color: #475569; margin: 0 0 8px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #334155; }
    .graph { overflow-x: auto; padding-top: 8px; }
    .empty { color: #64748b; }
  </style>
</head>
<body>
  <header>
    <h1>Workflow Visualization</h1>
  </header>
  <main>
    ${sections || '<p class="empty">No workflows found.</p>'}
  </main>
</body>
</html>`

      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
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

  private renderWorkflowSvg(workflow: any): string {
    const triggerLabel = this.formatTriggerLabel(workflow.trigger || {})
    const stepLabels = (workflow.steps || []).map((step: any, index: number) => `${index + 1}. ${step.type}`)
    const nodes = [triggerLabel, ...stepLabels, 'complete']

    const nodeWidth = 170
    const nodeHeight = 48
    const hGap = 48
    const padding = 24
    const width = padding * 2 + nodes.length * nodeWidth + (nodes.length - 1) * hGap
    const height = 130
    const y = 36

    const rects = nodes.map((label, idx) => {
      const x = padding + idx * (nodeWidth + hGap)
      const isTrigger = idx === 0
      const isEnd = idx === nodes.length - 1
      const fill = isTrigger ? '#e0f2fe' : isEnd ? '#dcfce7' : '#f8fafc'
      const stroke = isTrigger ? '#0284c7' : isEnd ? '#16a34a' : '#64748b'
      return `
        <rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" fill="${fill}" stroke="${stroke}" />
        <text x="${x + nodeWidth / 2}" y="${y + 28}" text-anchor="middle" font-size="12" fill="#0f172a">${this.escapeHtml(label)}</text>
      `
    }).join('\n')

    const arrows = nodes.slice(0, -1).map((_, idx) => {
      const fromX = padding + idx * (nodeWidth + hGap) + nodeWidth
      const toX = padding + (idx + 1) * (nodeWidth + hGap)
      const lineY = y + nodeHeight / 2
      return `<line x1="${fromX}" y1="${lineY}" x2="${toX}" y2="${lineY}" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)" />`
    }).join('\n')

    return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Workflow graph for ${this.escapeHtml(workflow.name)}">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
    </marker>
  </defs>
  ${arrows}
  ${rects}
</svg>`
  }

  private formatTriggerLabel(trigger: any): string {
    if (trigger?.manual) {
      return 'manual trigger'
    }
    if (trigger?.entity && trigger?.event) {
      return `${trigger.entity}.${trigger.event}`
    }
    if (trigger?.webhook) {
      return `webhook ${trigger.webhook}`
    }
    if (trigger?.schedule) {
      return `schedule ${trigger.schedule}`
    }
    return 'trigger'
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
