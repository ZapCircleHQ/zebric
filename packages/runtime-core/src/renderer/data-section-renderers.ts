/**
 * Data Section Renderers
 *
 * Standalone functions for rendering related data sections,
 * checklists, timelines, and activity feeds.
 */

import type { Blueprint } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import { html, SafeHtml, safe } from '../security/html-escape.js'
import { RendererUtils } from './renderer-utils.js'

/**
 * Render a checklist of items
 */
export function renderChecklist(items: any[], utils: RendererUtils, _theme?: Theme): SafeHtml {
  return html`
    <ul class="space-y-2">
      ${safe(items.map(item => {
        const isDone = ['done', 'complete', 'completed'].includes(String(item.status || '').toLowerCase())
        return html`
          <li class="flex items-center justify-between rounded border zb-border px-3 py-2">
            <div>
              <p class="text-sm font-medium zb-text-primary">${utils.getRecordLabel(item)}</p>
              ${item.dueDate ? html`<p class="text-xs zb-text-secondary">Due ${utils.formatValue(item.dueDate, 'Date')}</p>` : ''}
            </div>
            <span class="text-xs font-semibold ${isDone ? 'zb-state-success' : 'zb-text-secondary'}">
              ${item.status || ''}
            </span>
          </li>
        `.html
      }).join(''))}
    </ul>
  `
}

/**
 * Render a timeline visualization
 */
export function renderRampTimeline(items: any[], utils: RendererUtils): SafeHtml {
  return html`
    <ol class="relative border-l zb-border">
      ${safe(items.map(item => html`
        <li class="mb-6 ml-4">
          <div class="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${item.status === 'approved' ? 'zb-marker-success' : 'zb-marker-neutral'}"></div>
          <p class="text-sm font-medium zb-text-primary">${utils.getRecordLabel(item)}</p>
          ${item.targetDate ? html`<p class="text-xs zb-text-secondary">Target ${utils.formatValue(item.targetDate, 'Date')}</p>` : ''}
          ${item.status ? html`<p class="text-xs zb-text-secondary">Status: ${item.status}</p>` : ''}
        </li>
      `.html).join(''))}
    </ol>
  `
}

/**
 * Render an activity feed
 */
export function renderActivityFeed(items: any[], utils: RendererUtils, _theme?: Theme): SafeHtml {
  return html`
    <ul role="list" class="divide-y zb-dividers rounded border zb-border">
      ${safe(items.map(item => html`
        <li class="px-4 py-3">
          <p class="text-sm zb-text-primary">${item.title || item.summary || item.action || item.kind || item.type || item.name || 'Event'}</p>
          ${item.detail || item.description || item.message ? html`<p class="text-xs zb-text-secondary whitespace-pre-wrap break-words">${String(item.detail || item.description || item.message)}</p>` : ''}
          ${item.timestamp || item.createdAt ? html`<p class="text-xs zb-text-secondary">${utils.formatValue(item.timestamp || item.createdAt, 'DateTime')}</p>` : ''}
        </li>
      `.html).join(''))}
    </ul>
  `
}

/**
 * Render a smart section based on entity name heuristics
 */
export function renderSmartSection(
  title: string,
  items: any[],
  entity: any,
  utils: RendererUtils,
  renderTable: (items: any[], entity: any) => SafeHtml
): SafeHtml {
  const hint = ((entity?.name as string) || title || '').toLowerCase()

  if (hint.includes('task')) {
    return items.length > 0
      ? renderChecklist(items, utils)
      : html`<p class="zb-text-secondary">No tasks found</p>`
  }

  if (hint.includes('milestone') || hint.includes('timeline')) {
    return items.length > 0
      ? renderRampTimeline(items, utils)
      : html`<p class="zb-text-secondary">No milestones yet</p>`
  }

  if (hint.includes('activity') || hint.includes('event')) {
    return items.length > 0
      ? renderActivityFeed(items, utils)
      : html`<p class="zb-text-secondary">No recent activity</p>`
  }

  return items.length > 0
    ? renderTable(items, entity)
    : html`<p class="zb-text-secondary">No ${utils.formatFieldName(title).toLowerCase()} found</p>`
}

/**
 * Render related data section for a detail page
 */
export function renderRelatedData(
  context: RenderContext,
  blueprint: Blueprint,
  theme: Theme,
  utils: RendererUtils,
  renderTable: (items: any[], entity: any) => SafeHtml,
  _entity?: any
): SafeHtml {
  const { page, data } = context

  // Find related queries (anything besides the main query)
  const mainQuery = Object.keys(page.queries || {})[0]
  const relatedQueries = Object.entries(page.queries || {})
    .filter(([name]) => name !== mainQuery)

  if (relatedQueries.length === 0) return safe('')

  return html`
    <div class="mt-8">
      ${safe(relatedQueries.map(([name, query]) => {
        const items = Array.isArray(data[name]) ? data[name] : []
        const relatedEntity = blueprint.entities.find(e => e.name === (query as any).entity)
        const sectionTitle = utils.formatFieldName(name)
        const rendered = renderSmartSection(sectionTitle, items, relatedEntity, utils, renderTable)

        return html`
          <div class="mb-6">
            <h2 class="${theme.heading2}">${sectionTitle}</h2>
            ${rendered}
          </div>
        `.html
      }).join(''))}
    </div>
  `
}
