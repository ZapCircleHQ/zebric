/**
 * File Template Loader
 *
 * Node.js template loader that reads templates from the filesystem.
 * Supports caching and hot-reloading in development mode.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  StringTemplate,
  NativeTemplateEngine,
  type TemplateLoader,
  type Template,
  type TemplateEngine
} from '@zebric/runtime-core'

export interface FileTemplateLoaderConfig {
  baseDir: string
  cache?: boolean
  engines?: Map<string, TemplateEngine>
}

/**
 * Template loader that reads from filesystem (Node.js only)
 */
export class FileTemplateLoader implements TemplateLoader {
  private baseDir: string
  private cache: boolean
  private engines: Map<string, TemplateEngine>
  private templateCache = new Map<string, Template>()

  constructor(config: FileTemplateLoaderConfig) {
    this.baseDir = config.baseDir
    this.cache = config.cache ?? true
    this.engines = config.engines || new Map([
      ['native', new NativeTemplateEngine()]
    ])
  }

  /**
   * Load template from file (async)
   */
  async load(source: string, engine: 'native' | 'handlebars' | 'liquid'): Promise<Template> {
    return this.loadSync(source, engine)
  }

  /**
   * Load template from file (sync)
   */
  loadSync(source: string, engine: 'native' | 'handlebars' | 'liquid'): Template {
    const cacheKey = `${source}:${engine}`

    // Check cache
    if (this.cache) {
      const cached = this.templateCache.get(cacheKey)
      if (cached) {
        return cached
      }
    }

    // Resolve file path
    const filePath = resolve(this.baseDir, source)

    // Read file
    let fileContent: string
    try {
      fileContent = readFileSync(filePath, 'utf-8')
    } catch (error) {
      throw new Error(`Failed to load template file '${source}': ${error instanceof Error ? error.message : String(error)}`)
    }

    // Get template engine
    const templateEngine = this.engines.get(engine)
    if (!templateEngine) {
      throw new Error(`Template engine '${engine}' not found`)
    }

    // Compile template
    const renderFn = templateEngine.compile(fileContent)
    const template = new StringTemplate(source, engine, renderFn)

    // Cache template
    if (this.cache) {
      this.templateCache.set(cacheKey, template)
    }

    return template
  }

  /**
   * Register a template engine
   */
  registerEngine(engine: TemplateEngine): void {
    this.engines.set(engine.name, engine)
  }

  /**
   * Clear template cache
   */
  clearCache(): void {
    this.templateCache.clear()
  }

  /**
   * Remove specific template from cache
   */
  invalidate(source: string, engine?: string): void {
    if (engine) {
      this.templateCache.delete(`${source}:${engine}`)
    } else {
      // Invalidate all engines for this source
      const engines = ['native', 'handlebars', 'liquid']
      engines.forEach(eng => {
        this.templateCache.delete(`${source}:${eng}`)
      })
    }
  }
}
