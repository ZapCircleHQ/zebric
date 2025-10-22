/**
 * HTML Renderer
 *
 * Server-side HTML rendering for Blueprint pages.
 * Renders complete HTML pages with no React/build step.
 *
 * SECURITY: All user-generated content is HTML-escaped to prevent XSS.
 */

import type { Page, Blueprint } from '../types/blueprint.js'
import type { Theme } from './theme.js'
import type { PluginRegistry } from '../plugins/index.js'
import { defaultTheme } from './theme.js'
import { html, escapeHtml, escapeHtmlAttr, escapeJs, SafeHtml, safe } from '../security/html-escape.js'

export interface RenderContext {
  page: Page
  data: Record<string, any>
  params: Record<string, string>
  query: Record<string, string>
  session?: any
  csrfToken?: string
}

export class HTMLRenderer {
  private reloadScript?: string

  constructor(
    private blueprint: Blueprint,
    private theme: Theme = defaultTheme,
    private pluginRegistry?: PluginRegistry
  ) {}

  /**
   * Set reload script for hot reload (development mode only)
   */
  setReloadScript(script: string): void {
    this.reloadScript = script
  }

  /**
   * Render complete HTML page
   */
  renderPage(context: RenderContext): string {
    const { page } = context

    // Check if this is a plugin layout
    if (this.pluginRegistry && page.layout) {
      const pluginLayout = this.pluginRegistry.getLayoutRenderer(page.layout)
      if (pluginLayout) {
        const pluginContext = {
          ...context,
          theme: this.theme
        }
        const content = pluginLayout(pluginContext)
        return this.wrapInDocument(page.title, safe(content), context.session, page.path)
      }
    }

    // Render layout-specific content
    let content: SafeHtml
    switch (page.layout) {
      case 'list':
        content = this.renderListLayout(context)
        break
      case 'detail':
        content = this.renderDetailLayout(context)
        break
      case 'form':
        content = this.renderFormLayout(context)
        break
      case 'dashboard':
        content = this.renderDashboardLayout(context)
        break
      case 'auth':
        content = this.renderAuthLayout(context)
        break
      default:
        content = this.renderCustomLayout(context)
    }

    // Wrap in document
    return this.wrapInDocument(page.title, content, context.session, page.path)
  }

  /**
   * Render list/table layout
   */
  private renderListLayout(context: RenderContext): SafeHtml {
    const { page, data } = context
    const queryName = Object.keys(page.queries || {})[0]
    const items = data[queryName] || []

    if (!Array.isArray(items)) {
      return this.renderError('Invalid data format for list layout')
    }

    const entity = this.blueprint.entities.find(
      e => e.name === page.queries?.[queryName]?.entity
    )

    return html`
      <div class="${this.theme.container}">
        ${this.renderPageHeader(page, entity)}
        ${items.length === 0
          ? this.renderEmptyState(entity?.name || 'items')
          : this.renderTable(items, entity)
        }
      </div>
    `
  }

  /**
   * Render detail page layout
   */
  private renderDetailLayout(context: RenderContext): SafeHtml {
    const { page, data } = context
    const queryName = Object.keys(page.queries || {})[0]
    const dataSource = data[queryName]
    let record = dataSource

    if (Array.isArray(dataSource)) {
      const targetId = context.params?.id || context.query?.id
      if (targetId) {
        record = dataSource.find((item) => item && String(item.id) === String(targetId)) || dataSource[0]
      } else {
        record = dataSource[0]
      }
    }

    if (!record) {
      return this.renderError('Record not found')
    }

    const entity = this.blueprint.entities.find(
      e => e.name === page.queries?.[queryName]?.entity
    )

    return html`
      <div class="${this.theme.container} ${this.theme.containerNarrow}">
        <div class="${this.theme.card}">
          <div class="p-6">
            <h1 class="${this.theme.heading1}">${page.title}</h1>
            ${this.renderDetailFields(record, entity)}
            ${this.renderDetailActions(record, entity, context)}
          </div>
        </div>
        ${this.renderRelatedData(context, entity)}
      </div>
    `
  }

  /**
   * Render form layout
   */
  private renderFormLayout(context: RenderContext): SafeHtml {
    const { page, data, csrfToken } = context
    const form = page.form

    if (!form) {
      return this.renderError('No form definition found')
    }

    // Get existing record if editing
    const record = this.resolveFormRecord(form, data)

    // Check if form has file fields to set enctype
    const hasFileFields = form.fields.some(f => f.type === 'file')
    const enctype = hasFileFields ? 'enctype="multipart/form-data"' : ''

    return html`
      <div class="${this.theme.container} ${this.theme.containerNarrow}">
        <h1 class="${this.theme.heading1}">${page.title}</h1>

        <form
          method="POST"
          action="${page.path}"
          ${safe(enctype)}
          class="${this.theme.form}"
          data-enhance="${this.resolveEnhancementMode()}"
        >
          ${csrfToken ? safe(`<input type="hidden" name="_csrf" value="${escapeHtmlAttr(csrfToken)}" />`) : ''}
          ${safe(form.fields.map(field => this.renderFormField(field, record)).join(''))}

          <div class="${this.theme.formActions}">
            <button
              type="button"
              onclick="history.back()"
              class="${this.theme.buttonSecondary}"
              aria-label="Cancel and go back"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="${this.theme.buttonPrimary}"
            >
              ${form.method === 'create' ? 'Create' : form.method === 'update' ? 'Update' : 'Delete'}
            </button>
          </div>
        </form>
      </div>
    `
  }

  /**
   * Render dashboard layout
   */
  private renderDashboardLayout(context: RenderContext): SafeHtml {
    const { page, data } = context

    // Dashboard typically has multiple data queries
    const widgets = Object.entries(page.queries || {}).map(([name, query]) => {
      const items = data[name] || []
      const entity = this.blueprint.entities.find(e => e.name === query.entity)

      return this.renderDashboardWidget(name, items, entity, query)
    })

    return html`
      <div class="${this.theme.container}">
        <h1 class="${this.theme.heading1}">${page.title}</h1>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
          ${safe(widgets.join(''))}
        </div>
      </div>
    `
  }

  /**
   * Render custom layout
   */
  private renderAuthLayout(context: RenderContext): SafeHtml {
    const { query } = context
    const callbackURL = query.callbackURL || '/'

    return html`
      <div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div class="max-w-md w-full space-y-8">
          <div>
            <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
              Sign in to your account
            </h2>
          </div>
          <form class="mt-8 space-y-6" action="/api/auth/sign-in/email" method="POST">
            <input type="hidden" name="callbackURL" value="${escapeHtmlAttr(callbackURL)}" />
            <div class="rounded-md shadow-sm -space-y-px">
              <div>
                <label for="email" class="sr-only">Email address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autocomplete="email"
                  required
                  class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                  placeholder="Email address"
                />
              </div>
              <div>
                <label for="password" class="sr-only">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  required
                  class="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                  placeholder="Password"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Sign in
              </button>
            </div>
          </form>
        </div>
      </div>
    `
  }

  private renderCustomLayout(context: RenderContext): SafeHtml {
    const { page, data } = context
    // For custom layouts, just render the data as JSON for now
    return html`
      <div class="${this.theme.container}">
        <h1 class="${this.theme.heading1}">${page.title}</h1>
        <div class="${this.theme.card} p-6">
          <pre class="text-sm overflow-auto">${JSON.stringify(data, null, 2)}</pre>
        </div>
      </div>
    `
  }

  // ==========================================================================
  // Component Renderers
  // ==========================================================================

  private renderPageHeader(page: Page, entity?: any): SafeHtml {
    const createPath = this.getEntityPagePath(entity?.name, 'create')
    const createHref = createPath || `${this.collectionPath(entity?.name || 'item')}/new`

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

  private renderTable(items: any[], entity?: any): SafeHtml {
    if (items.length === 0) return safe('')

    const fields = this.getDisplayFields(items[0], entity)
    const detailPath = this.getEntityPagePath(entity?.name, 'detail')
    const editPath = this.getEntityPagePath(entity?.name, 'update')
    const entityName = entity?.name || 'items'
    const tableCaption = `${entityName.charAt(0).toUpperCase()}${entityName.slice(1)} list`

    // Helper to get a readable identifier for an item
    const getItemIdentifier = (item: any): string => {
      // Try common identifier fields in order of preference
      const idField = item.name || item.title || item.id || item[fields[0]?.name]
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
                  ${this.formatFieldName(f.name)}
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
                    ${this.formatValue(item[f.name], f.type)}
                  </td>
                `.html).join(''))}
                <td class="${this.theme.tableCell} ${this.theme.tableActions}">
                  <a
                    href="${this.resolveEntityLink(detailPath, entity?.name, item)}"
                    class="${this.theme.linkPrimary}"
                    aria-label="View ${escapeHtmlAttr(itemId)}"
                  >
                    View
                  </a>
                  <a
                    href="${this.resolveEntityLink(editPath, entity?.name, item, 'edit')}"
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

  private renderDetailFields(record: any, entity?: any): SafeHtml {
    const fields = this.getDisplayFields(record, entity)

    return html`
      <dl class="space-y-4 mt-6">
        ${safe(fields.map(f => html`
          <div>
            <dt class="text-sm font-medium text-gray-500">
              ${this.formatFieldName(f.name)}
            </dt>
            <dd class="mt-1 text-sm text-gray-900">
              ${this.formatValue(record[f.name], f.type)}
            </dd>
          </div>
        `.html).join(''))}
      </dl>
    `
  }

  private renderDetailActions(record: any, entity?: any, _context?: RenderContext): SafeHtml {
    if (!entity) return safe('')

    const editPath = this.getEntityPagePath(entity.name, 'update')
    const deletePath = this.getEntityPagePath(entity.name, 'delete')
    const viewBase = this.collectionPath(entity.name)

    return html`
      <div class="mt-6 flex gap-3">
        <a
          href="${this.resolveEntityLink(editPath, entity.name, record, 'edit')}"
          class="${this.theme.buttonPrimary}"
        >
          Edit
        </a>
        <button
          onclick="if(confirm('Are you sure?')) { fetch('${this.resolveEntityLink(deletePath, entity.name, record, 'delete')}', {method:'DELETE'}).then(() => window.location.href='${viewBase}') }"
          class="${this.theme.buttonSecondary} text-red-600"
        >
          Delete
        </button>
      </div>
    `
  }

  private renderFormField(field: any, record?: any): string {
    const value = record?.[field.name] || field.default || ''
    const fieldName = escapeHtmlAttr(field.name)
    const fieldLabel = escapeHtml(field.label || this.formatFieldName(field.name))
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

  private renderInput(field: any, value: any, errorId?: string): string {
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

  private renderDashboardWidget(name: string, items: any[], entity?: any, _query?: any): SafeHtml {
    const count = Array.isArray(items) ? items.length : 0
    const recent = Array.isArray(items) ? items.slice(0, 5) : []
    const detailPath = this.getEntityPagePath(entity?.name, 'detail')
    const listPath = this.getEntityPagePath(entity?.name, 'list')

    return html`
      <div class="${this.theme.card}">
        <div class="p-6">
          <h3 class="${this.theme.heading3}">
            ${this.formatFieldName(name)}
          </h3>
          <p class="text-3xl font-bold mt-2">${count}</p>

          ${recent.length > 0 ? html`
            <ul class="mt-4 space-y-2">
              ${safe(recent.map(item => html`
                <li class="text-sm">
                  <a
                    href="${this.resolveEntityLink(detailPath, entity?.name || name, item)}"
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

  private renderEmptyState(entityName: string): SafeHtml {
    const createPath = this.getEntityPagePath(entityName, 'create')
    const createHref = createPath || `${this.collectionPath(entityName)}/new`

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

  private renderRelatedData(context: RenderContext, _entity?: any): SafeHtml {
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
          const relatedEntity = this.blueprint.entities.find(e => e.name === query.entity)

          return html`
            <div class="mb-6">
              <h2 class="${this.theme.heading2}">
                ${this.formatFieldName(name)}
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

  private renderError(message: string): SafeHtml {
    return safe(`
      <div class="${this.theme.container}">
        <div class="${this.theme.errorState}">
          <p>${escapeHtml(message)}</p>
        </div>
      </div>
    `)
  }

  /**
   * Render 404 Not Found page
   */
  render404(path: string): string {
    const content = safe(`
      <div class="${this.theme.container} ${this.theme.containerNarrow}">
        <div class="${this.theme.card}">
          <div class="p-12 text-center">
            <h1 class="text-6xl font-bold text-gray-400 mb-4">404</h1>
            <h2 class="${this.theme.heading2}">Page Not Found</h2>
            <p class="text-gray-600 mb-6">
              The page <code class="px-2 py-1 bg-gray-100 rounded">${escapeHtml(path)}</code> does not exist.
            </p>
            <a href="/" class="${this.theme.buttonPrimary}">
              Go to Home
            </a>
          </div>
        </div>
      </div>
    `)
    return this.wrapInDocument('404 - Page Not Found', content)
  }

  /**
   * Render 500 Internal Server Error page
   */
  render500(error?: string): string {
    const content = safe(`
      <div class="${this.theme.container} ${this.theme.containerNarrow}">
        <div class="${this.theme.card}">
          <div class="p-12 text-center">
            <h1 class="text-6xl font-bold text-red-400 mb-4">500</h1>
            <h2 class="${this.theme.heading2}">Internal Server Error</h2>
            <p class="text-gray-600 mb-6">
              Something went wrong on our end. Please try again later.
            </p>
            ${error ? `
              <details class="text-left">
                <summary class="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  Error Details
                </summary>
                <pre class="mt-2 p-4 bg-gray-100 rounded text-xs overflow-auto">${escapeHtml(error)}</pre>
              </details>
            ` : ''}
            <a href="/" class="${this.theme.buttonPrimary} mt-6 inline-block">
              Go to Home
            </a>
          </div>
        </div>
      </div>
    `)
    return this.wrapInDocument('500 - Internal Server Error', content)
  }

  /**
   * Render generic error page
   */
  renderErrorPage(statusCode: number, title: string, message: string): string {
    const content = safe(`
      <div class="${this.theme.container} ${this.theme.containerNarrow}">
        <div class="${this.theme.card}">
          <div class="p-12 text-center">
            <h1 class="text-6xl font-bold text-gray-400 mb-4">${statusCode}</h1>
            <h2 class="${this.theme.heading2}">${escapeHtml(title)}</h2>
            <p class="text-gray-600 mb-6">
              ${escapeHtml(message)}
            </p>
            <a href="/" class="${this.theme.buttonPrimary}">
              Go to Home
            </a>
          </div>
        </div>
      </div>
    `)
    return this.wrapInDocument(`${statusCode} - ${title}`, content)
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  private getDisplayFields(record: any, entity?: any): Array<{name: string, type: string}> {
    if (!record) return []

    // If we have entity definition, use it
    if (entity?.fields) {
      return entity.fields
        .filter((f: any) => !['id', 'createdAt', 'updatedAt'].includes(f.name))
        .map((f: any) => ({ name: f.name, type: f.type }))
    }

    // Otherwise infer from record
    return Object.keys(record)
      .filter(key => !['id', 'createdAt', 'updatedAt'].includes(key))
      .map(key => ({ name: key, type: typeof record[key] }))
  }

  private formatFieldName(name: string): string {
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim()
  }

  private formatValue(value: any, type: string): string {
    if (value === null || value === undefined) return '-'

    switch (type) {
      case 'DateTime':
      case 'Date':
        return new Date(value).toLocaleDateString()

      case 'Boolean':
        return value ? '✓' : '✗'

      case 'JSON':
        return JSON.stringify(value, null, 2)

      default:
        return String(value)
    }
  }

  private wrapInDocument(title: string, content: SafeHtml, session?: any, currentPath?: string): string {
    const viewTransitions = this.blueprint.ui?.view_transitions !== false
    const escapedTitle = escapeHtml(title)
    const escapedProjectName = escapeHtml(this.blueprint.project.name)

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${escapedTitle} - ${escapedProjectName}</title>

          <!-- Tailwind CSS CDN -->
          <script src="https://cdn.tailwindcss.com"></script>

          ${viewTransitions ? `
            <meta name="view-transition" content="same-origin">
            <style>
              @view-transition {
                navigation: auto;
              }

              ::view-transition-old(root),
              ::view-transition-new(root) {
                animation-duration: 0.2s;
                animation-timing-function: ease-in-out;
              }
            </style>
          ` : ''}

          <!-- Accessibility styles -->
          <style>
            /* Screen reader only content */
            .sr-only {
              position: absolute;
              width: 1px;
              height: 1px;
              padding: 0;
              margin: -1px;
              overflow: hidden;
              clip: rect(0, 0, 0, 0);
              white-space: nowrap;
              border-width: 0;
            }

            /* Show when focused for skip links */
            .sr-only:focus,
            .sr-only:active {
              position: static;
              width: auto;
              height: auto;
              padding: 0.5rem 1rem;
              margin: 0;
              overflow: visible;
              clip: auto;
              white-space: normal;
              background-color: #1F2937;
              color: white;
              z-index: 9999;
            }

            /* Enhanced focus visibility for keyboard navigation */
            .keyboard-nav *:focus {
              outline: 2px solid #4F46E5;
              outline-offset: 2px;
            }
          </style>
        </head>
        <body class="${this.theme.body}">
          <!-- Skip navigation link for keyboard users -->
          <a href="#main-content" class="sr-only focus:not-sr-only">
            Skip to main content
          </a>

          ${this.renderNav(session, currentPath).html}

          <main id="main-content" role="main" class="min-h-screen py-8">
            ${content.html}
          </main>

          ${this.renderFooter().html}
          ${this.renderClientScript().html}
          ${this.reloadScript || ''}
        </body>
      </html>
    `
  }

  private renderNav(session?: any, currentPath: string = '/'): SafeHtml {
    const navItems = this.blueprint.pages
      ?.filter((p) => !p.path.includes(':') && p.path !== '/')
      ?.slice(0, 5)
      ?.map((p) => {
        const isCurrent = currentPath === p.path
        return `
          <a
            href="${escapeHtmlAttr(p.path)}"
            class="${this.theme.navLink}"
            ${isCurrent ? 'aria-current="page"' : ''}
          >
            ${escapeHtml(p.title)}
          </a>
        `
      }) || []

    const authControl = session
      ? `
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-500">${escapeHtml(session.user?.name || session.user?.email || 'Signed in')}</span>
          <a
            href="/auth/sign-out?callbackURL=${encodeURIComponent(currentPath || '/')}"
            class="${this.theme.linkSecondary}"
            aria-label="Sign out"
          >
            Sign out
          </a>
        </div>
      `
      : `
        <a
          href="/auth/sign-in?callbackURL=${encodeURIComponent(currentPath || '/')}"
          class="${this.theme.linkPrimary}"
          aria-label="Sign in to your account"
        >
          Sign in
        </a>
      `

    return safe(`
      <nav aria-label="Primary navigation" class="${this.theme.nav}">
        <div class="${this.theme.container}">
          <div class="${this.theme.navContent}">
            <a
              href="/"
              class="${this.theme.navBrand}"
              aria-label="${escapeHtmlAttr(this.blueprint.project.name)} home"
            >
              ${escapeHtml(this.blueprint.project.name)}
            </a>
            <div class="${this.theme.navLinks} flex items-center gap-4">
              ${navItems.join('')}
              ${authControl}
            </div>
          </div>
        </div>
      </nav>
    `)
  }

  private renderFooter(): SafeHtml {
    return safe(`
      <footer class="border-t border-gray-200 mt-12 py-6">
        <div class="${this.theme.container}">
          <p class="text-center text-sm text-gray-500">
            Powered by ZBL Engine v0.1.0
          </p>
        </div>
      </footer>
    `)
  }

  private resolveEnhancementMode(): string {
    const mode = this.blueprint.ui?.progressive_enhancement
    if (!mode) {
      return 'auto'
    }
    return mode
  }

  private resolveFormRecord(form: any, data?: Record<string, any> | null): any {
    if (!form || !data) return null

    const entityName: string | undefined = form.entity
    const candidates: Array<any> = []

    if (data.record !== undefined) {
      candidates.push(data.record)
    }

    if (entityName) {
      if (data[entityName] !== undefined) {
        candidates.push(data[entityName])
      }

      const lower = this.lowercaseFirst(entityName)
      if (lower && lower !== entityName && data[lower] !== undefined) {
        candidates.push(data[lower])
      }

      const slug = this.slugify(entityName)
      if (slug && slug !== entityName && data[slug] !== undefined) {
        candidates.push(data[slug])
      }
    }

    const direct = this.normalizeRecordCandidate(candidates.find((candidate) => candidate !== undefined))
    if (direct) {
      return direct
    }

    for (const value of Object.values(data)) {
      const normalized = this.normalizeRecordCandidate(value)
      if (normalized) {
        return normalized
      }
    }

    return null
  }

  private normalizeRecordCandidate(value: any): any {
    if (!value) return null
    if (Array.isArray(value)) {
      return value.length > 0 ? value[0] : null
    }
    if (typeof value === 'object') {
      return value
    }
    return null
  }

  private lowercaseFirst(value?: string): string | undefined {
    if (!value || value.length === 0) return value
    return value.charAt(0).toLowerCase() + value.slice(1)
  }

  private renderClientScript(): SafeHtml {
    return safe(`
      <script>
        // Minimal form enhancement
        document.querySelectorAll('form[data-enhance]').forEach(form => {
          if (form.dataset.enhance === 'none') return

          form.addEventListener('submit', async (e) => {
            e.preventDefault()

            const submitBtn = form.querySelector('button[type="submit"]')
            const originalText = submitBtn ? submitBtn.textContent : ''
            if (submitBtn) {
              submitBtn.textContent = 'Saving...'
              submitBtn.disabled = true
            }

            // Reset inline errors
            form.querySelectorAll('[data-error]').forEach(el => {
              el.textContent = ''
              el.classList.add('hidden')
            })

            try {
              const formData = new FormData(form)

              // Check if form has file inputs
              const hasFiles = Array.from(formData.entries()).some(([_, value]) => value instanceof File)

              let response
              if (hasFiles) {
                // Use multipart/form-data for file uploads
                response = await fetch(form.action, {
                  method: form.getAttribute('method') || 'POST',
                  headers: {
                    'Accept': 'application/json'
                    // Don't set Content-Type - browser will set it with boundary
                  },
                  body: formData
                })
              } else {
                // Use JSON for regular forms
                const data = Object.fromEntries(formData)
                response = await fetch(form.action, {
                  method: form.getAttribute('method') || 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                  },
                  body: JSON.stringify(data)
                })
              }

              const contentType = response.headers.get('content-type') || ''
              const hasJson = contentType.includes('application/json')
              const result = hasJson ? await response.json() : null

              if (response.redirected) {
                window.location.href = response.url
                return
              }

              if (response.ok && result && result.redirect) {
                window.location.href = result.redirect
                return
              }

              if (!response.ok) {
                if (result?.errors?.length) {
                  result.errors.forEach(err => {
                    const errorEl = form.querySelector('[data-error="' + err.field + '"]')
                    if (errorEl) {
                      errorEl.textContent = err.message
                      errorEl.classList.remove('hidden')
                    }
                  })
                } else {
                  alert(result?.message || 'An error occurred')
                }
              } else if (result?.message) {
                alert(result.message)
              }
            } catch (error) {
              alert('An error occurred')
            } finally {
              if (submitBtn) {
                submitBtn.textContent = originalText || 'Submit'
                submitBtn.disabled = false
              }
            }
          })
        })
      </script>
    `)
  }

  private getEntityPagePath(entityName: string | undefined, type: 'create' | 'detail' | 'update' | 'delete' | 'list'): string | null {
    if (!entityName) return null

    const pages = this.blueprint.pages
    if (!pages) return null

    switch (type) {
      case 'create':
        return pages.find((page) => page.form?.entity === entityName && page.form.method === 'create')?.path || null
      case 'update':
        return pages.find((page) => page.form?.entity === entityName && page.form.method === 'update')?.path || null
      case 'delete':
        return pages.find((page) => page.form?.entity === entityName && page.form.method === 'delete')?.path || null
      case 'detail':
        return pages.find((page) => page.layout === 'detail' && this.pageTargetsEntity(page, entityName))?.path || null
      case 'list':
        {
          const candidates = pages.filter((page) => page.layout === 'list' && this.pageTargetsEntity(page, entityName))
          if (candidates.length === 0) return null
          const slug = this.slugify(entityName)
          const preferred = candidates.find((page) => page.path !== '/' && page.path.includes(slug))
          return (preferred ?? candidates[0]).path
        }
      default:
        return null
    }
  }

  private pageTargetsEntity(page: Page, entityName: string): boolean {
    if (page.queries && Object.values(page.queries).some((query) => query.entity === entityName)) {
      return true
    }
    if (page.form?.entity === entityName) {
      return true
    }
    return false
  }

  private resolveEntityLink(
    template: string | null | undefined,
    entityName: string | undefined,
    item: any,
    fallbackSuffix?: 'edit' | 'delete'
  ): string {
    if (template) {
      return this.interpolatePath(template, item)
    }

    const base = this.collectionPath(entityName || 'item')
    if (fallbackSuffix === 'edit') {
      return `${base}/${encodeURIComponent(item.id)}/edit`
    }
    if (fallbackSuffix === 'delete') {
      return `${base}/${encodeURIComponent(item.id)}/delete`
    }
    return `${base}/${encodeURIComponent(item.id)}`
  }

  private interpolatePath(pathTemplate: string, params: Record<string, any>): string {
    return pathTemplate.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
      const value = params[key]
      return value === undefined || value === null ? '' : encodeURIComponent(String(value))
    })
  }

  private slugify(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/\s+/g, '-')
      .toLowerCase()
  }

  private collectionPath(entityName: string): string {
    const slug = this.slugify(entityName)
    return `/${slug}${slug.endsWith('s') ? '' : 's'}`
  }

  private getLoginPath(): string {
    const explicit = this.blueprint.pages.find((page) => page.path.includes('sign-in') || page.path.includes('login'))
    return explicit?.path || '/auth/sign-in'
  }

  private getSignupPath(): string {
    const explicit = this.blueprint.pages.find((page) => page.path.includes('sign-up') || page.path.includes('register'))
    return explicit?.path || '/api/auth/sign-up/email'
  }

  private getLoginAction(): string {
    return '/api/auth/sign-in/email'
  }

  renderLoginRequired(page: Page, request: any): string {
    const target = request.url || page.path || '/'
    const loginUrl = `${this.getLoginPath()}${this.getLoginPath().includes('?') ? '&' : '?'}callbackURL=${encodeURIComponent(target)}`

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Sign in required - ${escapeHtml(this.blueprint.project.name)}</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="${this.theme.body}">
          <div class="${this.theme.container} ${this.theme.containerNarrow}">
            <div class="${this.theme.card} p-8 text-center space-y-6">
              <h1 class="${this.theme.heading1}">Sign in required</h1>
              <p class="text-gray-600">You need to sign in to access <code>${escapeHtml(page.path)}</code>.</p>
              <a class="${this.theme.buttonPrimary}" href="${loginUrl}">Go to sign in</a>
            </div>
          </div>
        </body>
      </html>
    `
  }

  renderSignInPage(callbackURL: string, message?: string): string {
    const action = this.getLoginAction()
    const escapedCallbackAttr = escapeHtmlAttr(callbackURL || '/')
    const escapedCallbackJs = escapeJs(callbackURL || '/')
    const escapedActionJs = escapeJs(action)
    const feedback = message ? `<p id="auth-feedback" class="text-sm text-emerald-600">${escapeHtml(message)}</p>` : '<p id="auth-feedback" class="text-sm text-emerald-600"></p>'

    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Sign in - ${escapeHtml(this.blueprint.project.name)}</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="${this.theme.body}">
          <div class="min-h-screen flex items-center justify-center p-6">
            <div class="${this.theme.card} w-full max-w-md p-8">
              <h1 class="${this.theme.heading1} text-center">Sign in to continue</h1>
              ${feedback}
              <form id="sign-in-form" class="space-y-4 mt-4" method="POST" action="${action}">
                <input type="hidden" name="callbackURL" value="${escapedCallbackAttr}">
                <div>
                  <label class="${this.theme.label}" for="email">Email</label>
                  <input class="${this.theme.input}" type="email" name="email" id="email" required autocomplete="email">
                </div>
                <div>
                  <label class="${this.theme.label}" for="password">Password</label>
                  <input class="${this.theme.input}" type="password" name="password" id="password" required autocomplete="current-password">
                </div>
                <div class="flex items-center justify-between text-sm text-gray-600">
                  <label class="inline-flex items-center">
                    <input type="checkbox" name="rememberMe" class="mr-2"> Remember me
                  </label>
                  <a href="/forgot-password" class="${this.theme.linkSecondary}">Forgot password?</a>
                </div>
                <button type="submit" class="${this.theme.buttonPrimary} w-full">Sign in</button>
              </form>
              <p class="mt-6 text-sm text-center text-gray-500">
                Don't have an account? <a href="${this.getSignupPath()}" class="${this.theme.linkPrimary}">Sign up</a>
              </p>
            </div>
          </div>
          <script>
            document.addEventListener('DOMContentLoaded', () => {
              const form = document.getElementById('sign-in-form')
              if (!form) return
              const feedback = document.getElementById('auth-feedback')
              const endpoint = '${escapedActionJs}'
              const callbackURL = '${escapedCallbackJs}'
              const emailInput = form.querySelector('input[name="email"]')
              const passwordInput = form.querySelector('input[name="password"]')
              const rememberInput = form.querySelector('input[name="rememberMe"]')
              const submitButton = form.querySelector('button[type="submit"]')

              form.addEventListener('submit', async (event) => {
                event.preventDefault()
                if (feedback) {
                  feedback.textContent = ''
                  feedback.classList.remove('text-red-600')
                  feedback.classList.add('text-emerald-600')
                }
                if (submitButton) {
                  submitButton.disabled = true
                  submitButton.textContent = 'Signing in…'
                }

                const payload = {
                  email: emailInput?.value || '',
                  password: passwordInput?.value || '',
                  rememberMe: !!rememberInput?.checked,
                  callbackURL,
                }

                try {
                  const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Accept': 'application/json',
                    },
                    credentials: 'include',
                    body: JSON.stringify(payload),
                  })

                  if (response.ok) {
                    window.location.href = callbackURL || '/'
                    return
                  }

                  let message = 'Sign in failed. Please try again.'
                  try {
                    const data = await response.json()
                    message = data?.message || data?.error || message
                  } catch (_) {
                    // ignore
                  }

                  if (feedback) {
                    feedback.textContent = message
                    feedback.classList.remove('text-emerald-600')
                    feedback.classList.add('text-red-600')
                  }
                } catch (error) {
                  if (feedback) {
                    feedback.textContent = 'Network error. Please check your connection and try again.'
                    feedback.classList.remove('text-emerald-600')
                    feedback.classList.add('text-red-600')
                  }
                } finally {
                  if (submitButton) {
                    submitButton.disabled = false
                    submitButton.textContent = 'Sign in'
                  }
                }
              })
            })
          </script>
        </body>
      </html>
    `
  }

  renderSignOutPage(callbackURL: string): string {
    const escapedCallbackJs = escapeJs(callbackURL || '/')
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Signing out - ${escapeHtml(this.blueprint.project.name)}</title>
          <script>
            async function signOut() {
              try {
                await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' })
              } catch (error) {
                console.error('Failed to sign out', error)
              } finally {
                window.location.href = '${escapedCallbackJs}'
              }
            }
            window.addEventListener('DOMContentLoaded', signOut)
          </script>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="${this.theme.body}">
          <div class="min-h-screen flex items-center justify-center p-6">
            <div class="${this.theme.card} w-full max-w-md p-8 text-center space-y-4">
              <h1 class="${this.theme.heading1}">Signing you out…</h1>
              <p class="text-gray-600">You will be redirected shortly.</p>
              <noscript>
                <p class="text-sm text-gray-500">JavaScript is required to sign out automatically. <a href="/api/auth/sign-out" class="${this.theme.linkPrimary}">Click here</a> instead.</p>
              </noscript>
            </div>
          </div>
        </body>
      </html>
    `
  }


}
