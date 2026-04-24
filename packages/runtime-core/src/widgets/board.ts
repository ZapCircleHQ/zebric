/**
 * Board (Kanban) widget renderer.
 *
 * Reads a row entity and a column entity from the page's queries, groups rows
 * by the foreign-key field, and emits HTML with data attributes the client
 * runtime hooks for drag-and-drop, inline column rename, and card toggles.
 */

import type { Widget, WidgetCardToggle, Page } from '../types/blueprint.js'
import type { WidgetRenderContext } from './types.js'
import { safe, escapeHtml, escapeHtmlAttr } from '../security/html-escape.js'

export function renderBoardWidget(ctx: WidgetRenderContext) {
  const { page, widget, data } = ctx

  const columns = findByEntity(data, page, widget.column_entity)
  const items = findByEntity(data, page, widget.entity)

  const columnOrder = widget.column_order || 'position'
  const sortedColumns = [...columns].sort(
    (a, b) => (a?.[columnOrder] ?? 0) - (b?.[columnOrder] ?? 0)
  )

  const groupBy = widget.group_by || 'columnId'
  const rankField = widget.rank_field || 'position'
  const byColumn = new Map<string, any[]>()
  for (const col of sortedColumns) {
    byColumn.set(col.id, [])
  }
  for (const item of items) {
    const colId = item?.[groupBy]
    const bucket = byColumn.get(colId)
    if (bucket) bucket.push(item)
  }
  for (const bucket of byColumn.values()) {
    bucket.sort((a, b) => (a?.[rankField] ?? 0) - (b?.[rankField] ?? 0))
  }

  const labelField = widget.column_label || 'name'
  const titleField = widget.card?.title || 'title'
  const toggles = widget.card?.toggles || []

  const config = {
    pagePath: page.path,
    entity: widget.entity,
    columnEntity: widget.column_entity,
    events: {
      move: Boolean(widget.on_move),
      columnRename: Boolean(widget.on_column_rename),
      toggle: Boolean(widget.on_toggle),
    },
  }

  const columnsHtml = sortedColumns
    .map((col) => renderColumn(col, labelField, byColumn.get(col.id) || [], titleField, toggles, widget))
    .join('')

  return safe(`
    <div class="widget-board" data-control="board" data-control-config="${escapeHtmlAttr(JSON.stringify(config))}">
      <header class="widget-board-title">
        <h1>${escapeHtml(page.title)}</h1>
      </header>
      <div class="widget-board-columns">
        ${columnsHtml}
      </div>
    </div>
    ${BOARD_STYLES}
  `)
}

function renderColumn(
  col: any,
  labelField: string,
  cards: any[],
  titleField: string,
  toggles: WidgetCardToggle[],
  widget: Widget
): string {
  const editable = Boolean(widget.on_column_rename)
  const cardsHtml = cards.map((c) => renderCard(c, titleField, toggles, widget)).join('')
  return `
    <section class="widget-board-column" data-column-id="${escapeHtmlAttr(col.id)}">
      <header class="widget-board-column-header">
        <h2 class="widget-board-column-title"
            data-column-field="${escapeHtmlAttr(labelField)}"
            ${editable ? 'data-editable="true" title="Double-click to rename"' : ''}>${escapeHtml(col[labelField] ?? '')}</h2>
        <span class="widget-board-column-count">${cards.length}</span>
      </header>
      <ul class="widget-board-column-cards" data-column-dropzone>
        ${cardsHtml}
      </ul>
    </section>
  `
}

function renderCard(
  item: any,
  titleField: string,
  toggles: WidgetCardToggle[],
  widget: Widget
): string {
  const draggable = Boolean(widget.on_move)
  const togglesHtml = toggles
    .map((t) => renderToggle(item, t, Boolean(widget.on_toggle)))
    .join('')
  return `
    <li class="widget-board-card"
        data-card-id="${escapeHtmlAttr(item.id)}"
        ${draggable ? 'draggable="true"' : ''}>
      <span class="widget-board-card-title">${escapeHtml(item?.[titleField] ?? '')}</span>
      ${togglesHtml}
    </li>
  `
}

function renderToggle(item: any, toggle: WidgetCardToggle, enabled: boolean): string {
  const on = Boolean(item?.[toggle.field])
  const labelOn = toggle.label_on || toggle.label || '★'
  const labelOff = toggle.label_off || toggle.label || '☆'
  const label = on ? labelOn : labelOff
  const disabledAttr = enabled ? '' : 'disabled'
  return `<button type="button" class="widget-board-card-toggle${on ? ' widget-toggle-on' : ''}"
                 data-toggle-field="${escapeHtmlAttr(toggle.field)}"
                 data-toggle-value="${on ? 'true' : 'false'}"
                 data-label-on="${escapeHtmlAttr(labelOn)}"
                 data-label-off="${escapeHtmlAttr(labelOff)}"
                 aria-label="Toggle ${escapeHtmlAttr(toggle.field)}"
                 aria-pressed="${on ? 'true' : 'false'}"
                 ${disabledAttr}>${escapeHtml(label)}</button>`
}

function findByEntity(data: Record<string, any>, page: Page, entityName?: string): any[] {
  if (!entityName) return []
  const queries = page.queries || {}
  for (const [qName, qDef] of Object.entries(queries)) {
    if (qDef?.entity === entityName) {
      return Array.isArray(data[qName]) ? data[qName] : []
    }
  }
  return []
}

const BOARD_STYLES = `<style>
  .widget-board { padding: 1rem; }
  .widget-board-title h1 { font-size: 1.5rem; font-weight: 700; color: #111827; margin: 0 0 1rem 0; }
  .widget-board-columns { display: flex; gap: 1rem; overflow-x: auto; padding-bottom: 0.5rem; }
  .widget-board-column { flex: 0 0 300px; background: #f3f4f6; border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; max-height: calc(100vh - 200px); }
  .widget-board-column-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
  .widget-board-column-title { font-weight: 600; font-size: 0.875rem; color: #374151; margin: 0; outline: none; min-height: 1.5rem; flex: 1; }
  .widget-board-column-title[data-editable="true"] { cursor: text; }
  .widget-board-column-title[contenteditable="true"] { background: white; padding: 0.25rem 0.5rem; border-radius: 4px; box-shadow: 0 0 0 2px #3b82f6; }
  .widget-board-column-count { background: #e5e7eb; color: #6b7280; font-size: 0.75rem; padding: 0.125rem 0.5rem; border-radius: 9999px; font-weight: 600; margin-left: 0.5rem; }
  .widget-board-column-cards { list-style: none; margin: 0; padding: 0; min-height: 40px; overflow-y: auto; flex: 1; }
  .widget-board-card { background: white; padding: 0.75rem; border-radius: 6px; margin-bottom: 0.5rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); cursor: grab; display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; user-select: none; }
  .widget-board-card:active { cursor: grabbing; }
  .widget-board-card.widget-dragging { opacity: 0.4; }
  .widget-board-column-cards.widget-drop-active { background: #e5e7eb; border-radius: 6px; }
  .widget-board-card-title { flex: 1; font-size: 0.875rem; color: #111827; line-height: 1.4; }
  .widget-board-card-toggle { background: none; border: none; cursor: pointer; font-size: 1.125rem; padding: 0; line-height: 1; color: #9ca3af; transition: color 0.15s, transform 0.1s; }
  .widget-board-card-toggle:hover { transform: scale(1.15); }
  .widget-board-card-toggle.widget-toggle-on { color: #f59e0b; }
  .widget-board-card-toggle:disabled { cursor: default; opacity: 0.6; }
</style>`
