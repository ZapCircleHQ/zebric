/**
 * Component Renderers
 *
 * Reusable UI component rendering (tables, forms, widgets, etc.)
 */

import type { Blueprint, Page } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import { html, escapeHtml, escapeHtmlAttr, SafeHtml, safe } from '../security/html-escape.js'
import { RendererUtils } from './renderer-utils.js'

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
    if (items.length === 0) return safe('')

    const fields = this.utils.getDisplayFields(items[0], entity)
    const detailPath = this.utils.getEntityPagePath(entity?.name, 'detail')
    const editPath = this.utils.getEntityPagePath(entity?.name, 'update')
    const entityName = entity?.name || 'items'
    const tableCaption = `${entityName.charAt(0).toUpperCase()}${entityName.slice(1)} list`

    // Helper to get a readable identifier for an item
    const getItemIdentifier = (item: any): string => {
      // Try common identifier fields in order of preference
      const idField = item.name || item.title || item.id || (fields[0]?.name ? item[fields[0].name] : undefined)
      return idField ? String(idField) : 'item'
    }

    return html`
      <div class="${this.theme.card}">
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
            ${safe(items.map(item => {
              const itemId = getItemIdentifier(item)
              return html`
              <tr class="${this.theme.tableRow}">
                ${safe(fields.map(f => html`
                  <td class="${this.theme.tableCell}">
                    ${this.utils.formatValue(item[f.name], f.type)}
                  </td>
                `.html).join(''))}
                <td class="${this.theme.tableCell} ${this.theme.tableActions}">
                  <a
                    href="${this.utils.resolveEntityLink(detailPath, entity?.name, item)}"
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
   * Render form field
   */
  renderFormField(field: any, record?: any): string {
    const value = record?.[field.name] || field.default || ''
    const fieldName = escapeHtmlAttr(field.name)
    const fieldLabel = escapeHtml(field.label || this.utils.formatFieldName(field.name))
    const errorMsg = escapeHtml(field.error_message || '')
    const errorId = `${fieldName}-error`
    const hasError = !!field.error_message

    return `
      <div class="${this.theme.formField}">
        <label for="${fieldName}" class="${this.theme.label}">
          ${fieldLabel}
          ${field.required ? '<span class="text-red-500" aria-label="required">*</span>' : ''}
        </label>

        ${this.renderInput(field, value, hasError ? errorId : undefined)}

        ${field.error_message ? `
          <p id="${errorId}" class="${this.theme.fieldError} hidden" data-error="${fieldName}" role="alert">
            ${errorMsg}
          </p>
        ` : ''}
      </div>
    `
  }

  /**
   * Render form input element
   */
  renderInput(field: any, value: any, errorId?: string): string {
    const fieldName = escapeHtmlAttr(field.name)
    const fieldPattern = field.pattern ? `pattern="${escapeHtmlAttr(field.pattern)}"` : ''
    const required = field.required ? 'required' : ''
    const ariaInvalid = errorId ? 'aria-invalid="true"' : ''
    const ariaDescribedBy = errorId ? `aria-describedby="${errorId}"` : ''
    const autocomplete = this.getAutocompleteAttribute(field.name, field.type)
    const baseAttrs = `id="${fieldName}" name="${fieldName}" ${required} ${fieldPattern} ${ariaInvalid} ${ariaDescribedBy} ${autocomplete}`.trim()

    switch (field.type) {
      case 'textarea':
        return `
          <textarea
            ${baseAttrs}
            rows="${escapeHtmlAttr(field.rows || 4)}"
            placeholder="${escapeHtmlAttr(field.placeholder || '')}"
            class="${this.theme.textarea}"
          >${escapeHtml(value)}</textarea>
        `

      case 'select':
        return `
          <select ${baseAttrs} class="${this.theme.select}">
            ${field.options?.map((opt: any) => `
              <option value="${escapeHtmlAttr(opt)}" ${value === opt ? 'selected' : ''}>
                ${escapeHtml(opt)}
              </option>
            `).join('')}
          </select>
        `

      case 'checkbox':
        return `
          <input
            type="checkbox"
            ${baseAttrs}
            ${value ? 'checked' : ''}
            class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        `

      case 'file':
        return `
          <input
            type="file"
            ${baseAttrs}
            accept="${escapeHtmlAttr(field.accept?.join(',') || '')}"
            class="${this.theme.fileInput}"
          />
        `

      case 'date':
        return `
          <input
            type="date"
            ${baseAttrs}
            value="${escapeHtmlAttr(value)}"
            class="${this.theme.input}"
          />
        `

      case 'number':
        return `
          <input
            type="number"
            ${baseAttrs}
            value="${escapeHtmlAttr(value)}"
            min="${escapeHtmlAttr(field.min || '')}"
            max="${escapeHtmlAttr(field.max || '')}"
            step="${escapeHtmlAttr(field.step || '')}"
            class="${this.theme.input}"
          />
        `

      default:
        return `
          <input
            type="${escapeHtmlAttr(field.type || 'text')}"
            ${baseAttrs}
            value="${escapeHtmlAttr(value)}"
            placeholder="${escapeHtmlAttr(field.placeholder || '')}"
            class="${this.theme.input}"
          />
        `
    }
  }

  /**
   * Get appropriate autocomplete attribute based on field name and type
   */
  private getAutocompleteAttribute(fieldName: string, _fieldType?: string): string {
    const name = fieldName.toLowerCase()

    // Common autocomplete mappings
    const autocompleteMap: Record<string, string> = {
      'email': 'email',
      'username': 'username',
      'password': 'current-password',
      'new-password': 'new-password',
      'new_password': 'new-password',
      'confirm-password': 'new-password',
      'confirm_password': 'new-password',
      'name': 'name',
      'first-name': 'given-name',
      'firstname': 'given-name',
      'first_name': 'given-name',
      'last-name': 'family-name',
      'lastname': 'family-name',
      'last_name': 'family-name',
      'phone': 'tel',
      'telephone': 'tel',
      'mobile': 'tel',
      'address': 'street-address',
      'street': 'street-address',
      'city': 'address-level2',
      'state': 'address-level1',
      'zip': 'postal-code',
      'zipcode': 'postal-code',
      'postal-code': 'postal-code',
      'postal_code': 'postal-code',
      'country': 'country-name',
      'cc-number': 'cc-number',
      'cc-name': 'cc-name',
      'cc-exp': 'cc-exp',
      'cc-csc': 'cc-csc',
      'organization': 'organization',
      'company': 'organization',
      'url': 'url',
      'website': 'url',
      'birthday': 'bday',
      'birthdate': 'bday',
      'birth_date': 'bday'
    }

    const autocompleteValue = autocompleteMap[name]
    return autocompleteValue ? `autocomplete="${autocompleteValue}"` : ''
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
   * Render empty state message
   */
  renderEmptyState(entityName: string): SafeHtml {
    const createPath = this.utils.getEntityPagePath(entityName, 'create')
    const createHref = createPath || `${this.utils.collectionPath(entityName)}/new`

    return html`
      <div class="${this.theme.card}">
        <div class="${this.theme.emptyState}">
          <p class="text-gray-500">No ${entityName.toLowerCase()} found</p>
          <a
            href="${createHref}"
            class="${this.theme.buttonPrimary} mt-4 inline-block"
          >
            Create first ${entityName.toLowerCase()}
          </a>
        </div>
      </div>
    `
  }

  /**
   * Render related data section
   */
  renderRelatedData(context: RenderContext, _entity?: any): SafeHtml {
    const { page, data } = context

    // Find related queries (anything besides the main query)
    const mainQuery = Object.keys(page.queries || {})[0]
    const relatedQueries = Object.entries(page.queries || {})
      .filter(([name]) => name !== mainQuery)

    if (relatedQueries.length === 0) return safe('')

    return html`
      <div class="mt-8">
        ${safe(relatedQueries.map(([name, query]) => {
          const items = data[name] || []
          const relatedEntity = this.blueprint.entities.find(e => e.name === (query as any).entity)

          return html`
            <div class="mb-6">
              <h2 class="${this.theme.heading2}">
                ${this.utils.formatFieldName(name)}
              </h2>
              ${Array.isArray(items) && items.length > 0
                ? this.renderTable(items, relatedEntity)
                : html`<p class="text-gray-500">No ${name} found</p>`
              }
            </div>
          `.html
        }).join(''))}
      </div>
    `
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
