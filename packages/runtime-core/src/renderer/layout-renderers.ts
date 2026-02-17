/**
 * Layout Renderers
 *
 * Layout-specific rendering logic (list, detail, form, dashboard, auth, custom)
 */

import type { Blueprint, Page, LayoutSlotName } from '../types/blueprint.js'
import type { RenderContext, SlotContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import type { Template, TemplateRegistry, TemplateLoader } from './template-system.js'
import { html, escapeHtmlAttr, SafeHtml, safe } from '../security/html-escape.js'
import { ComponentRenderers } from './component-renderers.js'
import { RendererUtils } from './renderer-utils.js'
import { SlotRenderer } from './slot-renderer.js'

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
      () => this.componentRenderers.renderTable(items, entity)
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
      <h1 class="${this.theme.heading1}">${page.title}</h1>

      <form
        method="POST"
        action="${page.path}"
        ${safe(enctype)}
        class="${this.theme.form}"
        data-enhance="${this.resolveEnhancementMode()}"
      >
        ${csrfToken ? safe(`<input type="hidden" name="_csrf" value="${escapeHtmlAttr(csrfToken)}" />`) : ''}
        ${safe(form.fields.map((field: any) => this.componentRenderers.renderFormField(field, record)).join(''))}

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
