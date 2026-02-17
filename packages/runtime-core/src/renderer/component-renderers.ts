/**
 * Component Renderers
 *
 * Reusable UI component rendering (tables, forms, widgets, etc.)
 * Delegates to focused modules for form, action bar, and data section rendering.
 */

import type { Blueprint, Page } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import { html, escapeHtml, escapeHtmlAttr, SafeHtml, safe } from '../security/html-escape.js'
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
    const createHref = createPath || `${this.utils.collectionPath(entity?.name || 'item')}/new`

    return html`
      <div class="${this.theme.pageHeader}">
        <h1 class="${this.theme.heading1}">${page.title}</h1>
        ${entity ? html`
          <a
            href="${createHref}"
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
  renderTable(items: any[], entity?: any): SafeHtml {
    const fields = this.utils.getDisplayFields(items[0], entity)
    const detailPath = this.utils.getEntityPagePath(entity?.name, 'detail')
    const editPath = this.utils.getEntityPagePath(entity?.name, 'update')
    const entityName = entity?.name || 'items'
    const tableCaption = `${entityName.charAt(0).toUpperCase()}${entityName.slice(1)} list`
    const dataColumns = fields.length > 0 ? fields.length : 1
    const rowCountDescription = `${items.length} row${items.length === 1 ? '' : 's'} of data`

    // Helper to get a readable identifier for an item
    const getItemIdentifier = (item: any): string => {
      // Try common identifier fields in order of preference
      const idField = item.name || item.title || item.id || (fields[0]?.name ? item[fields[0].name] : undefined)
      return idField ? String(idField) : 'item'
    }

    return html`
      <div class="${this.theme.card}">
        <p class="px-6 pt-6 text-sm text-gray-500">${rowCountDescription}</p>
        <table class="${this.theme.table}">
          <caption class="sr-only">${tableCaption}</caption>
          <thead>
            <tr>
              ${safe(fields.map(f => html`
                <th scope="col" class="${this.theme.tableHeader}">
                  ${this.utils.formatFieldName(f.name)}
                </th>
              `.html).join(''))}
              <th scope="col" class="${this.theme.tableHeader}">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${items.length === 0
              ? html`
                <tr class="${this.theme.tableRow}">
                  <td colspan="${dataColumns + 1}" class="${this.theme.tableCell} text-gray-500">
                    No rows to display.
                  </td>
                </tr>
              `
              : safe(items.map(item => {
                const itemId = getItemIdentifier(item)
                const detailHref = this.utils.resolveEntityLink(detailPath, entity?.name, item)
                return html`
                <tr class="${this.theme.tableRow}">
                  ${safe(fields.map((f, index) => {
                    const value = this.utils.formatValue(item[f.name], f.type)
                    return html`
                      <td class="${this.theme.tableCell}">
                        ${index === 0
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
                  <td class="${this.theme.tableCell} ${this.theme.tableActions}">
                    <a
                      href="${detailHref}"
                      class="${this.theme.linkPrimary}"
                      aria-label="View ${escapeHtmlAttr(itemId)}"
                    >
                      View
                    </a>
                    <a
                      href="${this.utils.resolveEntityLink(editPath, entity?.name, item, 'edit')}"
                      class="${this.theme.linkSecondary}"
                      aria-label="Edit ${escapeHtmlAttr(itemId)}"
                    >
                      Edit
                    </a>
                  </td>
                </tr>
              `.html
              }).join(''))}
          </tbody>
        </table>
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
            <dt class="text-sm font-medium text-gray-500">
              ${this.utils.formatFieldName(f.name)}
            </dt>
            <dd class="mt-1 text-sm text-gray-900">
              ${this.utils.formatValue(record[f.name], f.type)}
            </dd>
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

    return html`
      <div class="mt-6 flex gap-3">
        <a
          href="${this.utils.resolveEntityLink(editPath, entity.name, record, 'edit')}"
          class="${this.theme.buttonPrimary}"
        >
          Edit
        </a>
        <button
          onclick="if(confirm('Are you sure?')) { fetch('${this.utils.resolveEntityLink(deletePath, entity.name, record, 'delete')}', {method:'DELETE'}).then(() => window.location.href='${viewBase}') }"
          class="${this.theme.buttonSecondary} text-red-600"
        >
      Delete
    </button>
  </div>
`
  }

  /**
   * Render action bar for detail pages
   */
  renderActionBar(page: Page, record: any, entity?: any, csrfToken?: string): SafeHtml {
    return renderActionBarFn(page, record, this.theme, this.utils, entity, csrfToken)
  }

  /**
   * Render form field
   */
  renderFormField(field: any, record?: any): string {
    return renderFormFieldFn(field, this.theme, this.utils, record)
  }

  /**
   * Render form input element
   */
  renderInput(field: any, value: any, errorId?: string): string {
    return renderInputFn(field, value, this.theme, errorId)
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
                  <a
                    href="${this.utils.resolveEntityLink(detailPath, entity?.name || name, item)}"
                    class="${this.theme.linkPrimary}"
                  >
                    ${item.title || item.name || item.id}
                  </a>
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
      (items, entity) => this.renderTable(items, entity),
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
}
