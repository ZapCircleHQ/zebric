/**
 * Hono route helpers for the Zebric widget system.
 *
 * Both runtime-node and runtime-worker mount a Hono app; these helpers
 * register the widget event + lookup search routes using the platform-
 * agnostic handlers in runtime-core. Each runtime provides concrete
 * QueryExecutorPort / SessionManagerPort implementations.
 */

import type { Hono } from 'hono'
import {
  handleWidgetEvent,
  handleLookupSearch,
  type Blueprint,
  type QueryExecutorPort,
  type SessionManagerPort,
} from '@zebric/runtime-core'

export interface WidgetRoutesDeps {
  blueprint: Blueprint
  queryExecutor: QueryExecutorPort
  sessionManager?: SessionManagerPort
  triggerWorkflow?: (name: string, data: Record<string, any>) => void
}

export function registerWidgetRoutes(app: Hono, deps: WidgetRoutesDeps): void {
  const { blueprint, queryExecutor, sessionManager, triggerWorkflow } = deps

  const hasAnyWidget = (blueprint.pages || []).some((p) => p.widget && (p.widget as any).kind)
  if (!hasAnyWidget) return

  app.post('/_widget/event', async (c) => {
    try {
      const body = await c.req.json().catch(() => null)
      const result = await handleWidgetEvent(blueprint, body, c.req.raw as any, {
        queryExecutor,
        sessionManager,
        triggerWorkflow,
      })
      return Response.json(result.body, { status: result.status })
    } catch (err) {
      console.error('widget event error:', err)
      return Response.json(
        {
          error: 'Widget event failed',
          details: err instanceof Error ? err.message : 'Unknown error'
        },
        { status: 500 }
      )
    }
  })
}

export interface SearchRoutesDeps {
  blueprint: Blueprint
  queryExecutor: QueryExecutorPort
  sessionManager?: SessionManagerPort
}

export function registerSearchRoutes(app: Hono, deps: SearchRoutesDeps): void {
  const { blueprint, queryExecutor, sessionManager } = deps

  const hasAnyLookup = (blueprint.pages || []).some((p) => {
    if (p.widget && (p.widget as any).kind === 'lookup') return true
    return p.form?.fields?.some((f) => f.type === 'lookup') ?? false
  })
  if (!hasAnyLookup) return

  app.get('/_widget/search', async (c) => {
    const result = await handleLookupSearch(
      blueprint,
      {
        page: c.req.query('page'),
        field: c.req.query('field'),
        q: c.req.query('q') || '',
      },
      c.req.raw as any,
      { queryExecutor, sessionManager }
    )
    return Response.json(result.body, { status: result.status })
  })
}
