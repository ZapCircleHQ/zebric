/**
 * Widget event handler — translates declarative widget events from TOML
 * (on_move, on_edit, on_column_rename, on_toggle) into concrete entity
 * mutations by substituting placeholders in the update template.
 *
 * Placeholder vocabulary:
 *   $to.id        event target id (drag destination)
 *   $to.value     event target value (e.g., new column value)
 *   $index        drop index within the destination
 *   $value        new inline-edit value
 *   $field        the field being edited/toggled
 *   $now          ISO timestamp
 *   $row.<field>  current value of a field on the row being mutated
 *   !$row.<field> boolean negation of a field on the row
 *   $row.$field   current value of the dynamic field named in $field
 *   !$row.$field  boolean negation of the dynamic field
 *
 * Keys may also use $field to dynamically target a column (e.g.,
 * `update = { "$field" = "!$row.$field" }` for a generic toggle).
 */

import type { Blueprint } from '../types/blueprint.js'
import type { WidgetEventRequest, WidgetEventResolved } from './types.js'

export function resolveWidgetEvent(
  blueprint: Blueprint,
  req: WidgetEventRequest,
  row: Record<string, any>
): WidgetEventResolved | null {
  const page = blueprint.pages.find((p) => p.path === req.page)
  if (!page?.widget) return null

  const handler = (page.widget as any)[`on_${req.event}`]
  if (!handler?.update) return null

  const update = buildUpdatePayload(handler.update, row, req.ctx || {})
  return {
    entity: req.row.entity,
    id: req.row.id,
    update,
    workflow: handler.workflow,
  }
}

export function buildUpdatePayload(
  template: Record<string, any>,
  row: Record<string, any>,
  ctx: Record<string, any>
): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [rawKey, rawVal] of Object.entries(template)) {
    const key = resolveKey(rawKey, ctx)
    if (key === undefined || key === '') continue
    out[key] = resolveValue(rawVal, row, ctx)
  }
  return out
}

function resolveKey(key: string, ctx: Record<string, any>): string | undefined {
  if (key === '$field') {
    return typeof ctx.field === 'string' ? ctx.field : undefined
  }
  return key
}

function resolveValue(val: any, row: Record<string, any>, ctx: Record<string, any>): any {
  if (typeof val !== 'string') return val

  // Simple atoms
  if (val === '$now') return new Date().toISOString()
  if (val === '$index') return ctx.index
  if (val === '$value') return ctx.value
  if (val === '$field') return ctx.field
  if (val === '$to.id') return ctx.to?.id
  if (val === '$to.value') return ctx.to?.value

  // Dynamic row access
  if (val === '$row.$field' || val === '$row[$field]') {
    return typeof ctx.field === 'string' ? row[ctx.field] : undefined
  }
  if (val === '!$row.$field' || val === '!$row[$field]') {
    return typeof ctx.field === 'string' ? !row[ctx.field] : undefined
  }

  // Literal row field
  if (val.startsWith('!$row.')) return !row[val.slice(6)]
  if (val.startsWith('$row.')) return row[val.slice(5)]

  return val
}
