/**
 * Platform-agnostic widget event handler.
 *
 * Given a parsed event body and port-level dependencies, performs the
 * corresponding entity mutation and returns a {status, body} result. HTTP
 * framing (JSON parsing, header handling, CSRF, response construction) is
 * the responsibility of each runtime's adapter layer.
 */

import type { Blueprint } from '../types/blueprint.js'
import type { QueryExecutorPort, SessionManagerPort, HttpRequest } from '../routing/request-ports.js'
import { resolveWidgetEvent } from './event-handler.js'

export interface WidgetHandlerDeps {
  queryExecutor: QueryExecutorPort
  sessionManager?: SessionManagerPort
  /** Optional workflow trigger — called if the widget event has a `workflow` field. */
  triggerWorkflow?: (name: string, data: Record<string, any>) => void
}

export interface WidgetHandlerResult {
  status: number
  body: any
}

export async function handleWidgetEvent(
  blueprint: Blueprint,
  body: any,
  request: HttpRequest,
  deps: WidgetHandlerDeps
): Promise<WidgetHandlerResult> {
  if (!body || typeof body.page !== 'string' || typeof body.event !== 'string' ||
      !body.row || typeof body.row.entity !== 'string' || typeof body.row.id !== 'string') {
    return { status: 400, body: { error: 'Invalid widget event' } }
  }

  const session = deps.sessionManager ? await deps.sessionManager.getSession(request as any) : null

  // Load the current record so `$row.<field>` placeholders can read it.
  let row: Record<string, any> = {}
  try {
    const existing = await deps.queryExecutor.findById(body.row.entity, body.row.id)
    if (existing) row = existing
  } catch {
    // Tolerate missing — the row may have been created out-of-band.
  }

  const resolved = resolveWidgetEvent(blueprint, {
    page: body.page,
    event: body.event,
    row: body.row,
    ctx: body.ctx || {},
  }, row)

  if (!resolved) {
    return { status: 400, body: { error: `Unknown widget event: ${body.event}` } }
  }

  const result = await deps.queryExecutor.update(resolved.entity, resolved.id, resolved.update, { session })

  if (resolved.workflow && deps.triggerWorkflow) {
    try {
      deps.triggerWorkflow(resolved.workflow, { row: result, ctx: body.ctx, session })
    } catch (err) {
      // Workflow failures don't fail the event — they're fire-and-forget.
      console.warn(`widget event: workflow '${resolved.workflow}' trigger failed`, err)
    }
  }

  return { status: 200, body: { success: true, record: result } }
}
