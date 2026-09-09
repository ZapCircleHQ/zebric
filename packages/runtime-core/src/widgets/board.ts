/**
 * Board (Kanban) widget renderer.
 *
 * Groups a row entity into columns and emits HTML with data attributes the
 * client runtime hooks for drag-and-drop, inline column rename, and card
 * toggles. Columns come from either an inline `columns` list (fixed values,
 * e.g. a status enum) or a `column_entity` whose rows are read from the page's
 * queries.
 */

import type { Widget, WidgetCardToggle, Page } from '../types/blueprint.js'
import type { WidgetRenderContext } from './types.js'
import { safe, escapeHtml, escapeHtmlAttr } from '../security/html-escape.js'

export function renderBoardWidget(ctx: WidgetRenderContext) {
  const { page, widget, data } = ctx

  const items = findByEntity(data, page, widget.entity)

  const columnOrder = widget.column_order || 'position'
  const labelField = widget.column_label || 'name'

  // Inline columns (fixed values) take precedence over a column entity.
  const sortedColumns = widget.columns?.length
    ? widget.columns.map((col, index) => ({
        id: col.value,
        [labelField]: col.label,
        [columnOrder]: index,
        description: col.description,
      }))
    : [...findByEntity(data, page, widget.column_entity)].sort(
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
    .map((col) => renderColumn(col, labelField, byColumn.get(col.id) || [], widget))
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
  widget: Widget
): string {
  const editable = Boolean(widget.on_column_rename)
  const cardsHtml = cards.map((c) => renderCard(c, widget)).join('')
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

function renderCard(item: any, widget: Widget): string {
  const card = widget.card
  const titleField = card?.title || 'title'
  const draggable = Boolean(widget.on_move)
  const togglesHtml = (card?.toggles || [])
    .map((t) => renderToggle(item, t, Boolean(widget.on_toggle)))
    .join('')

  const titleText = escapeHtml(getPath(item, titleField) ?? '')
  const href = card?.href ? interpolate(card.href, item) : undefined
  const titleHtml = href
    ? `<a class="widget-board-card-title" href="${escapeHtmlAttr(href)}">${titleText}</a>`
    : `<span class="widget-board-card-title">${titleText}</span>`

  const subtitleVal = card?.subtitle ? getPath(item, card.subtitle) : undefined
  const subtitleHtml = isPresent(subtitleVal)
    ? `<span class="widget-board-card-subtitle">${escapeHtml(String(subtitleVal))}</span>`
    : ''

  const metaChips = (card?.meta || [])
    .map((field) => getPath(item, field))
    .filter(isPresent)
    .map((value) => `<span class="widget-board-card-meta-item">${escapeHtml(String(value))}</span>`)
    .join('')
  const metaHtml = metaChips ? `<div class="widget-board-card-meta">${metaChips}</div>` : ''

  return `
    <li class="widget-board-card"
        data-card-id="${escapeHtmlAttr(item.id)}"
        ${draggable ? 'draggable="true"' : ''}>
      <div class="widget-board-card-body">
        ${titleHtml}
        ${subtitleHtml}
        ${metaHtml}
      </div>
      ${togglesHtml}
    </li>
  `
}

function isPresent(value: any): boolean {
  return value !== undefined && value !== null && value !== ''
}

/** Read a possibly-dotted path (`theme.title`) off a record. */
function getPath(obj: any, path: string): any {
  if (!path) return undefined
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

/** Fill `{field}` / `{a.b}` tokens in a template from a record. */
function interpolate(template: string, item: any): string {
  return template.replace(/\{([\w.]+)\}/g, (_match, path) => {
    const value = getPath(item, path)
    return isPresent(value) ? String(value) : ''
  })
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
  .widget-board-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .widget-board-card-title { font-size: 0.875rem; color: #111827; line-height: 1.4; font-weight: 500; }
  a.widget-board-card-title { color: inherit; text-decoration: none; }
  a.widget-board-card-title:hover { text-decoration: underline; }
  .widget-board-card-subtitle { font-size: 0.75rem; color: #6b7280; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .widget-board-card-meta { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.125rem; }
  .widget-board-card-meta-item { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: #6b7280; background: #f3f4f6; border-radius: 4px; padding: 0.0625rem 0.375rem; }
  .widget-board-card-toggle { background: none; border: none; cursor: pointer; font-size: 1.125rem; padding: 0; line-height: 1; color: #9ca3af; transition: color 0.15s, transform 0.1s; }
  .widget-board-card-toggle:hover { transform: scale(1.15); }
  .widget-board-card-toggle.widget-toggle-on { color: #f59e0b; }
  .widget-board-card-toggle:disabled { cursor: default; opacity: 0.6; }
</style>`
