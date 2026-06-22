/**
 * Layout Renderers
 *
 * Layout-specific rendering logic (list, detail, form, dashboard, auth, custom)
 */

import type { Blueprint, Page, LayoutSlotName, BoardConfig } from '../types/blueprint.js'
import type { RenderContext, SlotContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import type { Template, TemplateRegistry, TemplateLoader } from './template-system.js'
import { html, escapeHtmlAttr, SafeHtml, safe } from '../security/html-escape.js'
import { ComponentRenderers } from './component-renderers.js'
import { RendererUtils } from './renderer-utils.js'
import { SlotRenderer } from './slot-renderer.js'
import { renderFormFields } from './form-section-renderer.js'
import { resolveFormFieldOptions } from './form-renderers.js'
import { renderWorkflowAction } from './action-button-renderer.js'

export class LayoutRenderers {
  private slotRenderer: SlotRenderer

  constructor(
    private blueprint: Blueprint,
    private theme: Theme,
    private templateRegistry: TemplateRegistry,
    private templateLoader: TemplateLoader,
    private builtinTemplates: Map<string, Template>,
    private slotTemplateCache: Map<string, Template>,
    private builtinTemplateEngine: any,
    private componentRenderers: ComponentRenderers,
    private utils: RendererUtils
  ) {
    this.slotRenderer = new SlotRenderer(
      templateRegistry,
      templateLoader,
      builtinTemplateEngine,
      slotTemplateCache,
      theme
    )
  }

  /**
   * Render with custom template
   */
  renderWithCustomTemplate(context: RenderContext): string | null {
    const { page } = context
    if (!page.template) {
      return null
    }

    try {
      const templateName = `custom:${page.path}`

      // Check if template is already loaded
      let template = this.templateRegistry.get(templateName)

      // If not loaded, try to load it
      if (!template && this.templateLoader.loadSync) {
        const engine = page.template.engine || 'liquid'
        template = this.templateLoader.loadSync(page.template.source, engine)
        template.name = templateName
        this.templateRegistry.set(templateName, template)
      }

      // Render with template
      if (template) {
        return template.render(context)
      }

      console.warn(`Custom template not found for page: ${page.path}`)
      return null
    } catch (error) {
      console.error(`Error rendering custom template for page ${page.path}:`, error)
      return null
    }
  }

  /**
   * Render list/table layout
   */
  renderListLayout(context: RenderContext): SafeHtml {
    const { page, data } = context
    const queryName = Object.keys(page.queries || {})[0]
    if (!queryName) {
      return this.componentRenderers.renderError('No query defined for list layout')
    }
    const items = data[queryName] || []

    if (!Array.isArray(items)) {
      return this.componentRenderers.renderError('Invalid data format for list layout')
    }

    const entity = this.blueprint.entities.find(
      e => e.name === page.queries?.[queryName]?.entity
    )

    const header = this.renderSlot(
      page,
      'list.header',
      context,
      { entity, theme: this.theme },
      () => this.componentRenderers.renderPageHeader(page, entity)
    )

    const tableBody = this.renderSlot(
      page,
      'list.body',
      context,
      { entity, items },
      () => this.componentRenderers.renderTable(items, entity, page)
    )

    const emptyBody = this.renderSlot(
      page,
      'list.empty',
      context,
      { entity, items },
      () => tableBody
    )

    const segments = {
      header,
      body: items.length === 0 ? emptyBody : tableBody,
    }

    return this.renderBuiltinLayout('list', context, {
      segments: this.serializeSegments(segments)
    })
  }

  /**
   * Render detail page layout
   */
  renderDetailLayout(context: RenderContext): SafeHtml {
    const { page, data } = context
    const queryName = Object.keys(page.queries || {})[0]
    if (!queryName) {
      return this.componentRenderers.renderError('No query defined for detail layout')
    }
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
      return this.componentRenderers.renderError('Record not found')
    }

    const entity = this.blueprint.entities.find(
      e => e.name === page.queries?.[queryName]?.entity
    )

    const actionBar = this.componentRenderers.renderActionBar(page, record, entity, context.csrfToken)

    const mainContent = html`
      <div class="${this.theme.card}">
        <div class="p-6">
          <h1 class="${this.theme.heading1}">${page.title}</h1>
          ${actionBar}
          ${this.componentRenderers.renderDetailFields(record, entity)}
          ${this.componentRenderers.renderDetailActions(record, entity, context)}
        </div>
      </div>
    `

    const main = this.renderSlot(
      page,
      'detail.main',
      context,
      { record, entity },
      () => mainContent
    )

    const related = this.renderSlot(
      page,
      'detail.related',
      context,
      { entity, data },
      () => this.componentRenderers.renderRelatedData(context, entity)
    )

    const segments = {
      main,
      related,
    }

    return this.renderBuiltinLayout('detail', context, {
      segments: this.serializeSegments(segments)
    })
  }

  /**
   * Render form layout
   */
  renderFormLayout(context: RenderContext): SafeHtml {
    const { page, data, csrfToken } = context
    const form = page.form

    if (!form) {
      return this.componentRenderers.renderError('No form definition found')
    }

    // Get existing record if editing
    const record = this.utils.resolveFormRecord(form, data)

    // Check if form has file fields to set enctype
    const hasFileFields = form.fields.some((f: any) => f.type === 'file')
    const enctype = hasFileFields ? 'enctype="multipart/form-data"' : ''

    const defaultForm = html`
      <h1 id="form-title" class="${this.theme.heading1}">${page.title}</h1>

      <form
        method="POST"
        action="${page.path}"
        ${safe(enctype)}
        class="${this.theme.form}"
        aria-labelledby="form-title"
        data-enhance="${this.resolveEnhancementMode()}"
        data-zebric-ux-pattern="${page.ux?.pattern || this.blueprint.ux?.pattern || ''}"
        data-zebric-primitive="form"
      >
        ${csrfToken ? safe(`<input type="hidden" name="_csrf" value="${escapeHtmlAttr(csrfToken)}" />`) : ''}
        ${renderFormFields(
          form,
          record,
          this.theme,
          (field, formRecord) => this.componentRenderers.renderFormField(
            resolveFormFieldOptions(field, data),
            formRecord
          )
        )}

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
    `

    const formHtml = this.renderSlot(
      page,
      'form.form',
      context,
      { form, record },
      () => defaultForm
    )

    return this.renderBuiltinLayout('form', context, {
      segments: this.serializeSegments({ form: formHtml })
    })
  }

  /**
   * Render dashboard layout
   */
  renderDashboardLayout(context: RenderContext): SafeHtml {
    const { page, data } = context

    // Dashboard typically has multiple data queries
    const widgets = Object.entries(page.queries || {}).map(([name, query]) => {
      const items = data[name] || []
      const entity = this.blueprint.entities.find(e => e.name === (query as any).entity)

      return this.componentRenderers.renderDashboardWidget(name, items, entity, query)
    })

    const defaultWidgets = html`
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
        ${safe(widgets.join(''))}
      </div>
    `

    const widgetsHtml = this.renderSlot(
      page,
      'dashboard.widgets',
      context,
      { widgets, data },
      () => defaultWidgets
    )

    return this.renderBuiltinLayout('dashboard', context, {
      segments: this.serializeSegments({ widgets: widgetsHtml })
    })
  }

  /**
   * Render a first-class board layout with progressively enhanced workflow moves.
   */
  renderBoardLayout(context: RenderContext): SafeHtml {
    const { page, data, csrfToken } = context
    const board = page.board as BoardConfig | undefined
    if (!board) {
      return this.componentRenderers.renderError('No board definition found')
    }

    const query = page.queries?.[board.query]
    const entity = this.blueprint.entities.find((candidate) => candidate.name === query?.entity)
    const sourceItems = Array.isArray(data[board.query]) ? [...data[board.query]] : []
    const items = board.orderBy
      ? sourceItems.sort((left, right) => compareBoardValues(
          getBoardValue(left, board.orderBy!),
          getBoardValue(right, board.orderBy!)
        ))
      : sourceItems

    const columns = board.columns.map((column, columnIndex) => {
      const columnItems = items.filter((item) => String(getBoardValue(item, board.groupBy) ?? '') === column.value)
      const cards = columnItems.map((item) => {
        const title = getBoardValue(item, board.card.title)
        const description = board.card.description
          ? getBoardValue(item, board.card.description)
          : undefined
        const href = board.card.href
          ? this.utils.interpolatePath(board.card.href, item)
          : this.utils.getEntityPagePath(entity?.name, 'detail')
            ? this.utils.resolveEntityLink(this.utils.getEntityPagePath(entity?.name, 'detail')!, entity?.name || '', item)
            : undefined
        const metadata = (board.card.fields || []).map((fieldPath) => html`
          <span class="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600">
            <span class="sr-only">${this.utils.formatFieldName(fieldPath)}: </span>
            ${getBoardValue(item, fieldPath) ?? '—'}
          </span>
        `)
        const moves = board.move && context.session
          ? board.columns
              .filter((target) => target.value !== column.value)
              .map((target) => renderWorkflowAction({
                label: `Move to ${target.label}`,
                workflow: board.move!.workflow,
                payload: { [board.move!.payloadField || board.groupBy]: target.value },
                redirect: page.path,
                successMessage: board.move!.successMessage || `Moving to ${target.label}.`,
                errorMessage: board.move!.errorMessage,
              }, item, entity, page, 'secondary', csrfToken, this.theme, this.utils, this.blueprint))
          : []

        return html`
          <article class="${this.theme.card} p-4" data-board-card data-record-id="${item.id ?? ''}">
            <h3 class="${this.theme.heading3}">
              ${href ? html`<a href="${href}" class="${this.theme.linkPrimary}">${title ?? item.id}</a>` : title ?? item.id}
            </h3>
            ${description ? html`<p class="mt-2 text-sm text-gray-600">${description}</p>` : ''}
            ${metadata.length ? html`<div class="mt-3 flex flex-wrap gap-2">${safe(metadata.map((entry) => entry.html).join(''))}</div>` : ''}
            ${moves.length ? html`
              <details class="mt-4 text-sm">
                <summary class="cursor-pointer font-medium">Move card</summary>
                <div class="mt-2 flex flex-col items-start gap-2">
                  ${safe(moves.map((move) => move.html).join(''))}
                </div>
              </details>
            ` : ''}
          </article>
        `
      })

      return html`
        <section
          class="min-w-0 rounded-lg bg-gray-100 p-3"
          data-board-column="${column.value}"
          aria-labelledby="board-column-${columnIndex}"
        >
          <header class="mb-3">
            <div class="flex items-center justify-between gap-2">
              <h2 id="board-column-${columnIndex}" class="${this.theme.heading3}">${column.label}</h2>
              <span class="text-sm text-gray-500" aria-label="${columnItems.length} cards">${columnItems.length}</span>
            </div>
            ${column.description ? html`<p class="mt-1 text-xs text-gray-500">${column.description}</p>` : ''}
          </header>
          <div class="space-y-3" data-board-cards>
            ${cards.length
              ? safe(cards.map((card) => card.html).join(''))
              : html`<p class="py-8 text-center text-sm text-gray-500">No cards</p>`}
          </div>
        </section>
      `
    })

    return html`
      <div class="${this.theme.container}" data-zebric-primitive="board">
        <header class="${this.theme.pageHeader}">
          <h1 class="${this.theme.heading1}">${page.title}</h1>
          <p class="mt-1 text-sm text-gray-600">${items.length} cards</p>
        </header>
        <div
          class="mt-6 grid gap-4 overflow-auto pb-4"
          style="grid-template-columns: repeat(${board.columns.length}, minmax(16rem, 1fr));"
          data-board
        >
          ${safe(columns.map((column) => column.html).join(''))}
        </div>
      </div>
    `
  }

  /**
   * Render auth layout
   */
  renderAuthLayout(context: RenderContext): SafeHtml {
    const { query } = context
    const callbackURL = query.callbackURL || '/'

    const content = html`
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
    `

    return this.renderBuiltinLayout('auth', context, {
      segments: this.serializeSegments({ content })
    })
  }

  /**
   * Render custom layout
   */
  renderCustomLayout(context: RenderContext): SafeHtml {
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

  /**
   * Serialize segments to plain string record
   */
  serializeSegments(segments: Record<string, SafeHtml | string>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(segments)) {
      result[key] = value instanceof SafeHtml ? value.toString() : String(value)
    }
    return result
  }

  /**
   * Render using a built-in layout template
   */
  renderBuiltinLayout(
    layout: string,
    context: RenderContext,
    data: Record<string, unknown>
  ): SafeHtml {
    const template = this.builtinTemplates.get(layout)
    if (!template) {
      throw new Error(`Built-in layout template not found: ${layout}`)
    }

    const rendererData = {
      theme: this.theme,
      ...data,
    }

    const templateContext = {
      ...context,
      renderer: rendererData,
    } as RenderContext & { renderer: typeof rendererData }

    const rendered = template.render(templateContext)
    return safe(rendered)
  }

  /**
   * Render a slot - delegates to SlotRenderer
   */
  renderSlot(
    page: Page,
    slotName: LayoutSlotName,
    context: RenderContext,
    slotData: SlotContext,
    fallback: () => SafeHtml
  ): SafeHtml {
    return this.slotRenderer.renderSlot(page, slotName, context, slotData, fallback)
  }

  /**
   * Resolve progressive enhancement mode
   */
  private resolveEnhancementMode(): string {
    const mode = this.blueprint.ui?.progressive_enhancement
    if (!mode) {
      return 'auto'
    }
    return mode
  }

}

function getBoardValue(record: any, path: string): any {
  return path.split('.').reduce((value, segment) => value?.[segment], record)
}

function compareBoardValues(left: any, right: any): number {
  if (left === right) return 0
  if (left === undefined || left === null) return 1
  if (right === undefined || right === null) return -1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}
