/**
 * HTML Renderer
 *
 * Server-side HTML rendering for Blueprint pages.
 * Renders complete HTML pages with no React/build step.
 *
 * SECURITY: All user-generated content is HTML-escaped to prevent XSS.
 */

import type { Page, Blueprint } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import { defaultTheme } from './theme.js'
import { safe } from '../security/html-escape.js'
import {
  MemoryTemplateRegistry,
  InlineTemplateLoader,
  StringTemplate,
  type TemplateRegistry,
  type TemplateLoader,
  type Template
} from './template-system.js'
import { createDefaultTemplates } from './default-templates.js'
import { createLiquidEngine } from './liquid-engine.js'
import { builtinLayoutTemplates } from './generated/builtin-layouts.js'
import { RendererUtils } from './renderer-utils.js'
import { ComponentRenderers } from './component-renderers.js'
import { LayoutRenderers } from './layout-renderers.js'
import { DocumentWrapper } from './document-wrapper.js'
import { AuthPageRenderers } from './auth-page-renderers.js'
import { ErrorPageRenderers } from './error-page-renderers.js'

export class HTMLRenderer {
  private templateRegistry: TemplateRegistry
  private templateLoader: TemplateLoader
  private builtinTemplates = new Map<string, Template>()
  private authTemplateCache = new Map<string, Template>()
  private slotTemplateCache = new Map<string, Template>()
  private builtinTemplateEngine = createLiquidEngine()

  // Helper renderers
  private utils: RendererUtils
  private componentRenderers: ComponentRenderers
  private layoutRenderers: LayoutRenderers
  private documentWrapper: DocumentWrapper
  private authPageRenderers: AuthPageRenderers
  private errorPageRenderers: ErrorPageRenderers

  constructor(
    private blueprint: Blueprint,
    private theme: Theme = defaultTheme,
    templateRegistry?: TemplateRegistry,
    templateLoader?: TemplateLoader
  ) {
    this.templateRegistry = templateRegistry || new MemoryTemplateRegistry()
    this.templateLoader = templateLoader || new InlineTemplateLoader()
    this.initializeBuiltinTemplates()

    // Initialize helper renderers
    this.utils = new RendererUtils(blueprint)
    this.componentRenderers = new ComponentRenderers(blueprint, theme, this.utils)
    this.layoutRenderers = new LayoutRenderers(
      blueprint,
      theme,
      this.templateRegistry,
      this.templateLoader,
      this.builtinTemplates,
      this.slotTemplateCache,
      this.builtinTemplateEngine,
      this.componentRenderers,
      this.utils
    )
    this.documentWrapper = new DocumentWrapper(blueprint, theme)
    this.authPageRenderers = new AuthPageRenderers(
      blueprint,
      theme,
      this.authTemplateCache,
      this.builtinTemplateEngine
    )
    this.errorPageRenderers = new ErrorPageRenderers(theme)

    // Note: Default templates are NOT loaded automatically
    // The built-in renderListLayout, renderDetailLayout, etc. methods are used instead
    // Users can load default templates explicitly if needed via loadDefaultTemplates()
  }

  /**
   * Set reload script for hot reload (development mode only)
   */
  setReloadScript(script: string): void {
    this.documentWrapper.setReloadScript(script)
  }

  /**
   * Load default templates into the registry
   * (Optional - the built-in render methods are used by default)
   */
  loadDefaultTemplates(): void {
    const defaultTemplates = createDefaultTemplates(this.theme)
    defaultTemplates.forEach((template, name) => {
      // Only set if not already registered (don't overwrite custom templates)
      if (!this.templateRegistry.has(name)) {
        this.templateRegistry.set(name, template)
      }
    })
  }

  /**
   * Render complete HTML page
   */
  renderPage(context: RenderContext): string {
    const { page } = context

    // Check for custom template first
      if (page.template) {
        const content = this.layoutRenderers.renderWithCustomTemplate(context)
        if (content) {
          return this.documentWrapper.wrapInDocument(page.title, safe(content), context.session, page.path, context.flash)
        }
      }

    // Check for layout template in registry (only if explicitly loaded by user)
    // Default templates are NOT checked here - we use built-in methods instead
    const layoutTemplateName = `layout:${page.layout}`
    const layoutTemplate = this.templateRegistry.get(layoutTemplateName)
    if (layoutTemplate) {
      const content = layoutTemplate.render(context)
      return this.documentWrapper.wrapInDocument(page.title, safe(content), context.session, page.path, context.flash)
    }

    // Use built-in layout rendering (full HTML implementations)
    let content
    switch (page.layout) {
      case 'list':
        content = this.layoutRenderers.renderListLayout(context)
        break
      case 'detail':
        content = this.layoutRenderers.renderDetailLayout(context)
        break
      case 'form':
        content = this.layoutRenderers.renderFormLayout(context)
        break
      case 'dashboard':
        content = this.layoutRenderers.renderDashboardLayout(context)
        break
      case 'auth':
        content = this.layoutRenderers.renderAuthLayout(context)
        break
      default:
        content = this.layoutRenderers.renderCustomLayout(context)
    }

    // Wrap in document
    return this.documentWrapper.wrapInDocument(page.title, content, context.session, page.path, context.flash)
  }

  /**
   * Render 404 Not Found page
   */
  render404(path: string): string {
    const { title, content } = this.errorPageRenderers.render404(path) as any
    return this.documentWrapper.wrapInDocument(title, content)
  }

  /**
   * Render 500 Internal Server Error page
   */
  render500(error?: string): string {
    const { title, content } = this.errorPageRenderers.render500(error) as any
    return this.documentWrapper.wrapInDocument(title, content)
  }

  /**
   * Render generic error page
   */
  renderErrorPage(statusCode: number, errorTitle: string, message: string): string {
    const { title, content } = this.errorPageRenderers.renderErrorPage(statusCode, errorTitle, message) as any
    return this.documentWrapper.wrapInDocument(title, content)
  }

  /**
   * Render login required page
   */
  renderLoginRequired(page: Page, request: any): string {
    return this.authPageRenderers.renderLoginRequired(page, request)
  }

  /**
   * Render sign-in page
   */
  renderSignInPage(callbackURL: string, message?: string): string {
    return this.authPageRenderers.renderSignInPage(callbackURL, message)
  }

  /**
   * Render sign-up page
   */
  renderSignUpPage(callbackURL: string, message?: string): string {
    return this.authPageRenderers.renderSignUpPage(callbackURL, message)
  }

  /**
   * Render sign-out page
   */
  renderSignOutPage(callbackURL: string): string {
    return this.authPageRenderers.renderSignOutPage(callbackURL)
  }

  /**
   * Initialize built-in layout templates
   */
  private initializeBuiltinTemplates(): void {
    builtinLayoutTemplates.forEach((templateSource, name) => {
      const renderFn = this.builtinTemplateEngine.compile(templateSource)
      const template = new StringTemplate(`builtin:${name}`, 'liquid', renderFn)
      this.builtinTemplates.set(name, template)
    })
  }
}
