/**
 * Component Renderers
 *
 * Reusable UI component rendering (tables, forms, widgets, etc.)
 * Delegates to focused modules for form, action bar, and data section rendering.
 */

import type { Blueprint, Page, PageUXConfig, QueryColumn } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import { html, escapeHtml, escapeHtmlAttr, escapeJs, SafeHtml, safe } from '../security/html-escape.js'
import { RendererUtils } from './renderer-utils.js'
import { renderFormField as renderFormFieldFn, renderInput as renderInputFn } from './form-renderers.js'
import { renderActionBar as renderActionBarFn } from './action-bar-renderer.js'
import {
  renderRelatedData as renderRelatedDataFn,
  renderChecklist as renderChecklistFn,
  renderRampTimeline as renderRampTimelineFn,
  renderActivityFeed as renderActivityFeedFn
} from './data-section-renderers.js'

export class ComponentRenderers {
  constructor(
    private blueprint: Blueprint,
    private theme: Theme,
    private utils: RendererUtils
  ) {}

  /**
   * Render page header with title and create button
   */
  renderPageHeader(page: Page, entity?: any): SafeHtml {
    const createPath = this.utils.getEntityPagePath(entity?.name, 'create')

    return html`
      <div class="${this.theme.pageHeader}">
        <h1 class="${this.theme.heading1}">${page.title}</h1>
        ${entity && createPath ? html`
          <a
            href="${createPath}"
            class="${this.theme.buttonPrimary}"
          >
            New ${entity.name}
          </a>
        ` : ''}
      </div>
    `
  }

  /**
   * Render table of items
   */
  renderTable(items: any[], entity?: any, page?: Page, options: { columns?: QueryColumn[] } = {}): SafeHtml {
    // An explicit `columns` list on the page query wins; otherwise show the entity's displayable fields.
    const explicitColumns = this.utils.resolveColumns(options.columns, entity)
    const fields: Array<{ name: string; type: string; label?: string; wrap?: boolean; showIdentifiers?: boolean }> =
      explicitColumns.length > 0 ? explicitColumns : this.utils.getDisplayFields(items[0], entity)
    // Long free text wraps (it would otherwise be cut off); short values stay on one line.
    const wraps = fields.map(f => this.utils.shouldWrapColumn(f.type, items.map(item => item[f.name]), (f as { wrap?: boolean }).wrap))
    const cellClass = (index: number, extra = '') => {
      const base = wraps[index]
        ? this.theme.tableCell.replace('whitespace-nowrap', 'whitespace-normal break-words align-top max-w-md')
        : this.theme.tableCell
      return `${base} ${extra}`.trim()
    }
    const detailPath = this.utils.getEntityPagePath(entity?.name, 'detail')
    const editPath = this.utils.getEntityPagePath(entity?.name, 'update')
    const entityName = entity?.name || 'items'
    const tableCaption = `${entityName.charAt(0).toUpperCase()}${entityName.slice(1)} list`
    const dataColumns = fields.length > 0 ? fields.length : 1
    const rowCountDescription = `${items.length} row${items.length === 1 ? '' : 's'} of data`
    const ux = this.resolvePageUX(page)
    const density = ux?.data?.density || this.blueprint.ux?.data?.density || 'comfortable'
    const densityClass = this.getTableDensityClass(density)
    const rowClick = ux?.interaction?.row_click || this.blueprint.ux?.interaction?.row_click
    const canViewDetails = Boolean(detailPath)
    const rowClickOpenDetail = rowClick === 'open-detail' && canViewDetails

    // Helper to get a readable identifier for an item
    const getItemIdentifier = (item: any): string => {
      return this.utils.getRecordLabel(item, entity?.name)
    }

    return html`
      <div class="${this.theme.card}" data-zebric-ux-pattern="${ux?.pattern || ''}" data-zebric-density="${density}">
        <p class="px-6 pt-6 text-sm zb-text-secondary">${rowCountDescription}</p>
        <div class="overflow-x-auto">
        <table class="${this.theme.table}">
          <caption class="sr-only">${tableCaption}</caption>
          <thead>
            <tr>
              ${safe(fields.map(f => html`
                <th scope="col" class="${this.theme.tableHeader}">
                  ${f.label ?? this.utils.formatFieldName(f.name)}
                </th>
              `.html).join(''))}
              <th scope="col" class="${this.theme.tableHeader}">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.length === 0
              ? html`
                <tr class="${this.theme.tableRow}">
                  <td colspan="${dataColumns + 1}" class="${this.theme.tableCell} zb-text-secondary">
                    No rows to display.
                  </td>
                </tr>
              `
              : safe(items.map(item => {
                const itemId = getItemIdentifier(item)
                const detailHref = canViewDetails
                  ? this.utils.resolveEntityLink(detailPath, entity?.name, item)
                  : ''
                return html`
                <tr
                  class="${this.theme.tableRow} ${rowClickOpenDetail ? 'cursor-pointer' : ''}"
                  ${rowClickOpenDetail ? safe(`data-row-click="open-detail" onclick="if (!event.target.closest('a, button, form, input, select, textarea')) window.location.href='${escapeJs(detailHref)}'"`) : ''}
                >
                  ${safe(fields.map((f, index) => {
                    const value = this.utils.formatValue(item[f.name], f.type, { showIdentifiers: f.showIdentifiers })
                    return html`
                      <td class="${cellClass(index, densityClass)}">
                        ${index === 0 && canViewDetails
                          ? html`
                            <a
                              href="${detailHref}"
                              class="${this.theme.linkPrimary}"
                              aria-label="View ${escapeHtmlAttr(itemId)} details"
                            >
                              ${value}
                            </a>
                          `
                          : value}
                      </td>
                    `.html
                  }).join(''))}
                  <td class="${this.theme.tableCell} ${densityClass} ${this.theme.tableActions}">
                    ${canViewDetails
                      ? html`
                        <a
                          href="${detailHref}"
                          class="${this.theme.linkPrimary}"
                          aria-label="View ${escapeHtmlAttr(itemId)}"
                        >
                          View
                        </a>
                      `
                      : ''}
                    ${editPath
                      ? html`
                        <a
                          href="${this.utils.resolveEntityLink(editPath, entity?.name, item)}"
                          class="${this.theme.linkSecondary}"
                          aria-label="Edit ${escapeHtmlAttr(itemId)}"
                        >
                          Edit
                        </a>
                      `
                      : ''}
                  </td>
                </tr>
              `.html
              }).join(''))}
          </tbody>
        </table>
        </div>
      </div>
    `
  }

  /**
   * Render detail fields as definition list
   */
  renderDetailFields(record: any, entity?: any): SafeHtml {
    const fields = this.utils.getDisplayFields(record, entity)

    return html`
      <dl class="space-y-4 mt-6">
        ${safe(fields.map(f => html`
          <div>
            <dt class="text-sm font-medium zb-text-secondary">
              ${this.utils.formatFieldName(f.name)}
            </dt>
            <dd class="mt-1 text-sm zb-text-primary${f.type === 'LongText' || f.type === 'JSON' ? ' whitespace-pre-wrap break-words' : ''}${f.type === 'JSON' ? ' font-mono zb-code text-xs' : ''}">${this.utils.formatValue(record[f.name], f.type, { showIdentifiers: f.showIdentifiers })}</dd>
          </div>
        `.html).join(''))}
      </dl>
    `
  }

  /**
   * Render detail actions (edit, delete)
   */
  renderDetailActions(record: any, entity?: any, _context?: RenderContext): SafeHtml {
    if (!entity) return safe('')

    const editPath = this.utils.getEntityPagePath(entity.name, 'update')
    const deletePath = this.utils.getEntityPagePath(entity.name, 'delete')
    const viewBase = this.utils.collectionPath(entity.name)

    if (!editPath && !deletePath) {
      return safe('')
    }

    return html`
      <div class="mt-6 flex gap-3">
        ${editPath
          ? html`
            <a
              href="${this.utils.resolveEntityLink(editPath, entity.name, record)}"
              class="${this.theme.buttonPrimary}"
            >
              Edit
            </a>
          `
          : ''}
        ${deletePath
          ? html`
            <button
              onclick="if(confirm('Are you sure?')) { fetch('${this.utils.resolveEntityLink(deletePath, entity.name, record)}', {method:'DELETE'}).then(() => window.location.href='${viewBase}') }"
              class="${this.theme.buttonSecondary} zb-button-danger"
            >
              Delete
            </button>
          `
          : ''}
      </div>
    `
  }

  /**
   * Render action bar for detail pages
   */
  renderActionBar(page: Page, record: any, entity?: any, csrfToken?: string, availableCommands?: string[]): SafeHtml {
    return renderActionBarFn(page, record, this.theme, this.utils, entity, csrfToken, this.blueprint, availableCommands)
  }

  /**
   * Render form field
   */
  renderFormField(field: any, record?: any, context?: { pagePath?: string }): string {
    return renderFormFieldFn(field, this.theme, this.utils, record, context)
  }

  /**
   * Render form input element
   */
  renderInput(field: any, value: any, errorId?: string, context?: { pagePath?: string }): string {
    return renderInputFn(field, value, this.theme, errorId, context)
  }

  /**
   * Render dashboard widget
   */
  renderDashboardWidget(name: string, items: any[], entity?: any, _query?: any): SafeHtml {
    const count = Array.isArray(items) ? items.length : 0
    const recent = Array.isArray(items) ? items.slice(0, 5) : []
    const detailPath = this.utils.getEntityPagePath(entity?.name, 'detail')
    const listPath = this.utils.getEntityPagePath(entity?.name, 'list')

    return html`
      <div class="${this.theme.card}">
        <div class="p-6">
          <h3 class="${this.theme.heading3}">
            ${this.utils.formatFieldName(name)}
          </h3>
          <p class="text-3xl font-bold mt-2">${count}</p>

          ${recent.length > 0 ? html`
            <ul class="mt-4 space-y-2">
              ${safe(recent.map(item => html`
                <li class="text-sm">
                  ${detailPath
                    ? html`
                      <a
                        href="${this.utils.resolveEntityLink(detailPath, entity?.name || name, item)}"
                        class="${this.theme.linkPrimary}"
                      >
                        ${this.utils.getRecordLabel(item, entity?.name)}
                      </a>
                    `
                    : this.utils.getRecordLabel(item, entity?.name)}
                </li>
              `.html).join(''))}
            </ul>
          ` : ''}

          ${listPath ? html`
            <a
              href="${listPath}"
              class="text-sm text-blue-600 hover:text-blue-800 mt-4 inline-block"
            >
              View all →
            </a>
          ` : ''}
        </div>
      </div>
    `
  }

  /**
   * Render related data section
   */
  renderRelatedData(context: RenderContext, _entity?: any): SafeHtml {
    return renderRelatedDataFn(
      context,
      this.blueprint,
      this.theme,
      this.utils,
      (items, entity, options) => this.renderTable(items, entity, context.page, options),
      _entity
    )
  }

  renderChecklist(items: any[]): SafeHtml {
    return renderChecklistFn(items, this.utils, this.theme)
  }

  renderRampTimeline(items: any[]): SafeHtml {
    return renderRampTimelineFn(items, this.utils)
  }

  renderActivityFeed(items: any[]): SafeHtml {
    return renderActivityFeedFn(items, this.utils, this.theme)
  }

  /**
   * Render error message
   */
  renderError(message: string): SafeHtml {
    return safe(`
      <div class="${this.theme.container}">
        <div class="${this.theme.errorState}">
          <p>${escapeHtml(message)}</p>
        </div>
      </div>
    `)
  }

  private resolvePageUX(page?: Page): PageUXConfig | undefined {
    return page?.ux
  }

  private getTableDensityClass(density: string): string {
    switch (density) {
      case 'compact':
        return '!px-4 !py-2'
      case 'spacious':
        return '!px-8 !py-6'
      default:
        return ''
    }
  }
}
