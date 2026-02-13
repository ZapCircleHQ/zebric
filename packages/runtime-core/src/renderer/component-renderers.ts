/**
 * Component Renderers
 *
 * Reusable UI component rendering (tables, forms, widgets, etc.)
 */

import type { Blueprint, Page, ActionBarAction } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import { html, escapeHtml, escapeHtmlAttr, SafeHtml, safe, attr } from '../security/html-escape.js'
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
   * Render action bar for detail pages
   */
  renderActionBar(page: Page, record: any, entity?: any, csrfToken?: string): SafeHtml {
    const config = page.actionBar
    if (!config) {
      return safe('')
    }

    const statusField = this.getStatusFieldName(config, entity)
    const statusValue = statusField ? record?.[statusField] : undefined
    const hasStatus =
      statusField &&
      statusValue !== undefined &&
      statusValue !== null &&
      statusValue !== ''

    const primaryActions = (config.actions || []).map(action =>
      this.renderPrimaryAction(action, record, entity, page, csrfToken)
    )
    const secondaryActions = (config.secondaryActions || []).map(action =>
      this.renderSecondaryAction(action, record, entity, page, csrfToken)
    )

    const hasPrimary = primaryActions.length > 0
    const hasSecondary = secondaryActions.length > 0
    const hasHeader = Boolean(config.title || config.description || hasStatus)
    const shouldRender = hasHeader || hasPrimary || hasSecondary

    if (!shouldRender) {
      return safe('')
    }

    return html`
      <div class="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-4">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          ${hasHeader ? html`
            <div class="space-y-2">
              ${config.title ? html`<p class="text-sm font-semibold text-gray-900">${config.title}</p>` : ''}
              ${hasStatus ? html`
                <div class="flex items-center gap-2 text-sm">
                  <span class="text-gray-500">
                    ${config.statusLabel || (statusField ? this.utils.formatFieldName(statusField) : '')}
                  </span>
                  <span class="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 capitalize">
                    ${this.utils.formatValue(statusValue, this.getFieldType(entity, statusField))}
                  </span>
                </div>
              ` : ''}
              ${config.description ? html`
                <p class="text-sm text-gray-600 max-w-prose">${config.description}</p>
              ` : ''}
            </div>
          ` : ''}

          ${hasPrimary ? html`
            <div class="flex flex-wrap gap-2">
              ${safe(primaryActions.map(action => action.html).join(''))}
            </div>
          ` : ''}
        </div>

        ${hasSecondary ? html`
          <div class="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
            ${safe(secondaryActions.map(action => action.html).join(''))}
          </div>
        ` : ''}
      </div>
    `
  }

  private renderPrimaryAction(action: ActionBarAction, record: any, entity?: any, page?: Page, csrfToken?: string): SafeHtml {
    if (action.workflow) {
      return this.renderWorkflowAction(action, record, entity, page, 'primary', csrfToken)
    }

    const method = (action.method || 'GET').toUpperCase()
    const href = action.href ? this.utils.interpolatePath(action.href, record) : '#'
    const buttonClass = this.getActionButtonClass(action.style)
    const confirmAttr = action.confirm ? attr('onclick', `return confirm('${escapeHtmlAttr(action.confirm)}')`) : ''

    if (method === 'POST') {
      return html`
        <form method="POST" action="${href}" class="inline" data-enhance="api">
          ${csrfToken ? html`<input type="hidden" name="_csrf" value="${escapeHtmlAttr(csrfToken)}" />` : ''}
          ${action.successMessage ? html`<input type="hidden" name="successMessage" value="${escapeHtmlAttr(action.successMessage)}" />` : ''}
          ${action.errorMessage ? html`<input type="hidden" name="errorMessage" value="${escapeHtmlAttr(action.errorMessage)}" />` : ''}
          <button type="submit" class="${buttonClass}"${confirmAttr}>
            ${action.label}
          </button>
        </form>
      `
    }

    return html`
      <a
        href="${href}"
        class="${buttonClass}"
        ${action.target ? attr('target', action.target) : ''}
        ${action.target === '_blank' ? attr('rel', 'noopener noreferrer') : ''}
        ${confirmAttr}
      >
        ${action.label}
      </a>
    `
  }

  private renderSecondaryAction(action: ActionBarAction, record: any, entity?: any, page?: Page, csrfToken?: string): SafeHtml {
    if (action.workflow) {
      return this.renderWorkflowAction(action, record, entity, page, 'secondary', csrfToken)
    }

    const href = action.href ? this.utils.interpolatePath(action.href, record) : '#'
    return html`
      <a
        href="${href}"
        class="${this.theme.linkSecondary} underline-offset-4 hover:underline"
        ${action.target ? attr('target', action.target) : ''}
        ${action.target === '_blank' ? attr('rel', 'noopener noreferrer') : ''}
        ${action.confirm ? attr('onclick', `return confirm('${escapeHtmlAttr(action.confirm)}')`) : ''}
      >
        ${action.label}
      </a>
    `
  }

  private renderWorkflowAction(
    action: ActionBarAction,
    record: any,
    entity: any,
    page: Page | undefined,
    variant: 'primary' | 'secondary',
    csrfToken?: string
  ): SafeHtml {
    const workflow = action.workflow!
    const payload = this.resolveActionPayload(action, record)
    const payloadJson = payload ? JSON.stringify(payload) : null
    const buttonClass =
      variant === 'primary'
        ? this.getActionButtonClass(action.style)
        : `${this.theme.linkSecondary} underline-offset-4 hover:underline`
    const redirectTarget = action.redirect
      ? this.utils.interpolatePath(action.redirect, record)
      : (page ? this.utils.interpolatePath(page.path, record ?? {}) : '')
    const confirmAttr = action.confirm ? attr('onclick', `return confirm('${escapeHtmlAttr(action.confirm)}')`) : ''

    return html`
      <form method="POST" action="/actions/${encodeURIComponent(workflow)}" class="inline" data-enhance="api">
        ${csrfToken ? html`<input type="hidden" name="_csrf" value="${escapeHtmlAttr(csrfToken)}" />` : ''}
        ${entity?.name ? html`<input type="hidden" name="entity" value="${escapeHtmlAttr(entity.name)}" />` : ''}
        ${record?.id ? html`<input type="hidden" name="recordId" value="${escapeHtmlAttr(record.id)}" />` : ''}
        ${page?.path ? html`<input type="hidden" name="page" value="${escapeHtmlAttr(page.path)}" />` : ''}
        ${redirectTarget ? html`<input type="hidden" name="redirect" value="${escapeHtmlAttr(redirectTarget)}" />` : ''}
        ${payloadJson ? html`<input type="hidden" name="payload" value='${escapeHtmlAttr(payloadJson)}' />` : ''}
        ${action.successMessage ? html`<input type="hidden" name="successMessage" value="${escapeHtmlAttr(action.successMessage)}" />` : ''}
        ${action.errorMessage ? html`<input type="hidden" name="errorMessage" value="${escapeHtmlAttr(action.errorMessage)}" />` : ''}
        <button type="submit" class="${buttonClass}"${confirmAttr}>
          ${action.label}
        </button>
      </form>
    `
  }

  private getActionButtonClass(variant?: string): string {
    switch (variant) {
      case 'secondary':
        return this.theme.buttonSecondary
      case 'danger':
        return `${this.theme.buttonSecondary} border-red-300 text-red-600 hover:bg-red-50`
      case 'ghost':
        return 'px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg border border-transparent'
      default:
        return this.theme.buttonPrimary
    }
  }

  private getStatusFieldName(config: Page['actionBar'], entity?: any): string | null {
    if (!config) return null
    if (config.showStatus === false) return null
    if (config.statusField) return config.statusField
    const hasStatusField = entity?.fields?.some((field: any) => field.name === 'status')
    return hasStatusField ? 'status' : null
  }

  private getFieldType(entity: any, fieldName?: string | null): string {
    if (!entity || !fieldName) {
      return 'Text'
    }
    const field = entity.fields?.find((f: any) => f.name === fieldName)
    return field?.type || 'Text'
  }

  private resolveActionPayload(action: ActionBarAction, record: any): Record<string, any> | undefined {
    if (!action.payload) {
      return undefined
    }

    const resolved: Record<string, any> = {}
    for (const [key, value] of Object.entries(action.payload)) {
      if (typeof value === 'string') {
        resolved[key] = this.utils.interpolateText(value, record)
      } else {
        resolved[key] = value
      }
    }

    return resolved
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
        {
          const selectedValue = value === undefined || value === null ? '' : String(value)
          const options = Array.isArray(field.options) ? field.options : []
          const optionHtml = options.map((opt: any) => {
            const isObjectOption = typeof opt === 'object' && opt !== null
            const rawValue = isObjectOption ? (opt.value ?? opt.label ?? '') : opt
            const rawLabel = isObjectOption ? (opt.label ?? opt.value ?? '') : opt
            const optionValue = rawValue === undefined || rawValue === null ? '' : String(rawValue)
            const optionLabel = rawLabel === undefined || rawLabel === null ? '' : String(rawLabel)
            const isSelected = selectedValue === optionValue

            return `
              <option value="${escapeHtmlAttr(optionValue)}" ${isSelected ? 'selected' : ''}>
                ${escapeHtml(optionLabel)}
              </option>
            `
          }).join('')

        return `
          <select ${baseAttrs} class="${this.theme.select}">
            ${optionHtml}
          </select>
        `
        }

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
          const items = Array.isArray(data[name]) ? data[name] : []
          const relatedEntity = this.blueprint.entities.find(e => e.name === (query as any).entity)
          const sectionTitle = this.utils.formatFieldName(name)
          const rendered = this.renderSmartSection(sectionTitle, items, relatedEntity, query)

          return html`
            <div class="mb-6">
              <h2 class="${this.theme.heading2}">${sectionTitle}</h2>
              ${rendered}
            </div>
          `.html
        }).join(''))}
      </div>
    `
  }

  private renderSmartSection(title: string, items: any[], entity: any, query: any): SafeHtml {
    const hint = ((entity?.name as string) || title || '').toLowerCase()

    if (hint.includes('task')) {
      return items.length > 0
        ? this.renderChecklist(items)
        : html`<p class="text-gray-500">No tasks found</p>`
    }

    if (hint.includes('milestone') || hint.includes('timeline')) {
      return items.length > 0
        ? this.renderRampTimeline(items)
        : html`<p class="text-gray-500">No milestones yet</p>`
    }

    if (hint.includes('activity') || hint.includes('event')) {
      return items.length > 0
        ? this.renderActivityFeed(items)
        : html`<p class="text-gray-500">No recent activity</p>`
    }

    return items.length > 0
      ? this.renderTable(items, entity)
      : html`<p class="text-gray-500">No ${this.utils.formatFieldName(title).toLowerCase()} found</p>`
  }

  renderChecklist(items: any[]): SafeHtml {
    return html`
      <ul class="space-y-2">
        ${safe(items.map(item => {
          const isDone = ['done', 'complete', 'completed'].includes(String(item.status || '').toLowerCase())
          return html`
            <li class="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
              <div>
                <p class="text-sm font-medium text-gray-900">${escapeHtml(item.title || item.name || item.id)}</p>
                ${item.dueDate ? html`<p class="text-xs text-gray-500">Due ${this.utils.formatValue(item.dueDate, 'Date')}</p>` : ''}
              </div>
              <span class="text-xs font-semibold ${isDone ? 'text-green-600' : 'text-gray-500'}">
                ${escapeHtml(item.status || '')}
              </span>
            </li>
          `.html
        }).join(''))}
      </ul>
    `
  }

  renderRampTimeline(items: any[]): SafeHtml {
    return html`
      <ol class="relative border-l border-gray-200">
        ${safe(items.map(item => html`
          <li class="mb-6 ml-4">
            <div class="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${item.status === 'approved' ? 'bg-green-600' : 'bg-gray-300'}"></div>
            <p class="text-sm font-medium text-gray-900">${escapeHtml(item.title || item.name || item.id)}</p>
            ${item.targetDate ? html`<p class="text-xs text-gray-500">Target ${this.utils.formatValue(item.targetDate, 'Date')}</p>` : ''}
            ${item.status ? html`<p class="text-xs text-gray-500">Status: ${escapeHtml(item.status)}</p>` : ''}
          </li>
        `.html).join(''))}
      </ol>
    `
  }

  renderActivityFeed(items: any[]): SafeHtml {
    return html`
      <ul role="list" class="divide-y divide-gray-100 rounded border border-gray-100">
        ${safe(items.map(item => html`
          <li class="px-4 py-3">
            <p class="text-sm text-gray-900">${escapeHtml(item.title || item.summary || item.action || 'Event')}</p>
            ${item.timestamp ? html`<p class="text-xs text-gray-500">${this.utils.formatValue(item.timestamp, 'DateTime')}</p>` : ''}
          </li>
        `.html).join(''))}
      </ul>
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
