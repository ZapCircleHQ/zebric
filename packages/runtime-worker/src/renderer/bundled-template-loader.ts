/**
 * Synchronous template loader for files bundled with a Worker.
 *
 * Worker bundlers can import text files (for example with Wrangler text rules)
 * and pass them to this loader keyed by the same relative path used in the
 * Blueprint. This preserves file-backed Blueprint templates without requiring
 * a filesystem at runtime.
 */

import {
  StringTemplate,
  createLiquidEngine,
  type Template,
  type TemplateEngine,
  type TemplateEngineName,
  type TemplateLoader,
} from '@zebric/runtime-core'

export interface BundledTemplateLoaderConfig {
  templates: Readonly<Record<string, string>> | ReadonlyMap<string, string>
  engines?: Map<string, TemplateEngine>
}

export class BundledTemplateLoader implements TemplateLoader {
  private templates: ReadonlyMap<string, string>
  private engines: Map<string, TemplateEngine>
  private cache = new Map<string, Template>()

  constructor(config: BundledTemplateLoaderConfig) {
    this.templates = config.templates instanceof Map
      ? config.templates
      : new Map(Object.entries(config.templates))
    this.engines = config.engines ?? new Map([
      ['liquid', createLiquidEngine()],
    ])
  }

  async load(source: string, engine: TemplateEngineName): Promise<Template> {
    return this.loadSync(source, engine)
  }

  loadSync(source: string, engine: TemplateEngineName): Template {
    const cacheKey = `${source}:${engine}`
    const cached = this.cache.get(cacheKey)
    if (cached) return cached

    const content = this.templates.get(source)
    if (content === undefined) {
      throw new Error(`Bundled template not found: ${source}`)
    }

    const templateEngine = this.engines.get(engine)
    if (!templateEngine) {
      throw new Error(`Template engine '${engine}' not found`)
    }

    const template = new StringTemplate(source, engine, templateEngine.compile(content))
    this.cache.set(cacheKey, template)
    return template
  }

  registerEngine(engine: TemplateEngine): void {
    this.engines.set(engine.name, engine)
  }

  clearCache(): void {
    this.cache.clear()
  }

  invalidate(source: string, engine?: TemplateEngineName): void {
    if (engine) {
      this.cache.delete(`${source}:${engine}`)
      return
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${source}:`)) this.cache.delete(key)
    }
  }
}
