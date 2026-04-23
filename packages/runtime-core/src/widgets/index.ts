/**
 * Widgets — declarative interactive views.
 *
 * A widget is a blueprint-described interactive view: drag-and-drop board,
 * sortable list, calendar, tree, etc. Each widget kind has a server-side
 * renderer that produces HTML and a shared client runtime that hooks the
 * HTML for user interactions. User interactions become typed events
 * (on_move, on_edit, on_column_rename, on_toggle) that the blueprint
 * maps to data updates — no arbitrary client JS per blueprint.
 */

import type { Widget } from '../types/blueprint.js'
import type { SafeHtml } from '../security/html-escape.js'
import { safe } from '../security/html-escape.js'
import type { WidgetRenderContext, WidgetRenderer } from './types.js'
import { renderBoardWidget } from './board.js'

export type { WidgetRenderContext, WidgetRenderer, WidgetEventRequest, WidgetEventResolved } from './types.js'
export { buildUpdatePayload, resolveWidgetEvent } from './event-handler.js'
export { WIDGET_CLIENT_RUNTIME } from './client-runtime.js'

const widgetRegistry = new Map<string, WidgetRenderer>([
  ['board', renderBoardWidget],
])

export function getWidgetRenderer(kind: string): WidgetRenderer | undefined {
  return widgetRegistry.get(kind)
}

export function registerWidget(kind: string, renderer: WidgetRenderer): void {
  widgetRegistry.set(kind, renderer)
}

export function renderWidget(ctx: WidgetRenderContext): SafeHtml {
  const renderer = getWidgetRenderer(ctx.widget.kind)
  if (!renderer) {
    return safe(`<div class="widget-error" style="padding: 1rem; color: #b91c1c; background: #fee2e2; border-radius: 6px;">
      Unknown widget kind: <code>${escapeBasic(ctx.widget.kind)}</code>
    </div>`)
  }
  return renderer(ctx)
}

export function pageHasWidget(page: { widget?: Widget }): boolean {
  return Boolean(page.widget?.kind)
}

function escapeBasic(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c] || c)
}
