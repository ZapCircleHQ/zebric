/**
 * Slot Renderer
 *
 * Handles rendering of layout slots with optional custom templates.
 */

import type { Page, PageTemplate, LayoutSlotName } from '../types/blueprint.js'
import type { RenderContext, SlotContext } from '../routing/request-ports.js'
import type { Theme } from './theme.js'
import type { Template, TemplateRegistry, TemplateLoader } from './template-system.js'
import { SafeHtml, safe } from '../security/html-escape.js'
import { StringTemplate } from './template-system.js'

export class SlotRenderer {
  constructor(
    private templateRegistry: TemplateRegistry,
    private templateLoader: TemplateLoader,
    private builtinTemplateEngine: any,
    private slotTemplateCache: Map<string, Template>,
    private theme: Theme
  ) {}

  /**
   * Render a slot with optional custom template
   */
  renderSlot(
    page: Page,
    slotName: LayoutSlotName,
    context: RenderContext,
    slotData: SlotContext,
    fallback: () => SafeHtml
  ): SafeHtml {
    const slotConfig = page.layoutSlots?.[slotName]
    if (!slotConfig) {
      return fallback()
    }

    const cacheKey = `slot:${page.path}:${slotName}`
    let template = this.slotTemplateCache.get(cacheKey)
    if (!template) {
      const loadedTemplate = this.loadSlotTemplate(cacheKey, slotConfig)
      if (loadedTemplate) {
        this.slotTemplateCache.set(cacheKey, loadedTemplate)
        template = loadedTemplate
      }
    }

    if (!template) {
      return fallback()
    }

    const slotContext: RenderContext = {
      ...context,
      renderer: {
        ...(context.renderer || {}),
        slot: slotData,
        theme: this.theme,
      },
    }

    try {
      return safe(template.render(slotContext))
    } catch (error) {
      console.error(`Failed to render slot "${slotName}" for page ${page.path}:`, error)
      return fallback()
    }
  }

  /**
   * Load a slot template
   */
  private loadSlotTemplate(cacheKey: string, config: PageTemplate): Template | null {
    const engine = config.engine || 'liquid'
    const type = config.type || 'inline'

    try {
      if (type === 'file') {
        if (!this.templateLoader.loadSync) {
          console.warn(`Slot template loader not available for ${cacheKey}`)
          return null
        }
        const template = this.templateLoader.loadSync(config.source, engine)
        template.name = cacheKey
        return template
      }

      if (engine !== 'liquid') {
        console.warn(`Inline layout slots currently support Liquid templates only (slot: ${cacheKey})`)
        return null
      }

      const renderFn = this.builtinTemplateEngine.compile(config.source)
      return new StringTemplate(cacheKey, 'liquid', renderFn)
    } catch (error) {
      console.error(`Failed to load slot template "${cacheKey}":`, error)
      return null
    }
  }
}
