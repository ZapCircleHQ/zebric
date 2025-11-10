/**
 * KV Template Loader
 *
 * CloudFlare Workers template loader that reads templates from KV storage.
 * Supports caching with KV's built-in TTL.
 */

import {
  StringTemplate,
  NativeTemplateEngine,
  type TemplateLoader,
  type Template,
  type TemplateEngine
} from '@zebric/runtime-core'

export interface KVTemplateLoaderConfig {
  kv: KVNamespace
  keyPrefix?: string
  cacheTtl?: number // Cache TTL in seconds (default: 3600)
  engines?: Map<string, TemplateEngine>
}

/**
 * Template loader that reads from KV storage (CloudFlare Workers only)
 */
export class KVTemplateLoader implements TemplateLoader {
  private kv: KVNamespace
  private keyPrefix: string
  private cacheTtl: number
  private engines: Map<string, TemplateEngine>
  private localCache = new Map<string, { template: Template; timestamp: number }>()
  private localCacheTtl = 60000 // 1 minute local cache

  constructor(config: KVTemplateLoaderConfig) {
    this.kv = config.kv
    this.keyPrefix = config.keyPrefix || 'template:'
    this.cacheTtl = config.cacheTtl ?? 3600
    this.engines = config.engines || new Map([
      ['native', new NativeTemplateEngine()]
    ])
  }

  /**
   * Load template from KV storage (async)
   */
  async load(source: string, engine: 'native' | 'handlebars' | 'liquid'): Promise<Template> {
    const cacheKey = `${source}:${engine}`

    // Check local cache first (reduces KV reads)
    const localCached = this.localCache.get(cacheKey)
    if (localCached && Date.now() - localCached.timestamp < this.localCacheTtl) {
      return localCached.template
    }

    // Build KV key
    const kvKey = `${this.keyPrefix}${source}`

    // Read from KV
    let templateContent: string | null
    try {
      templateContent = await this.kv.get(kvKey, 'text')
    } catch (error) {
      throw new Error(`Failed to load template from KV '${source}': ${error instanceof Error ? error.message : String(error)}`)
    }

    if (!templateContent) {
      throw new Error(`Template not found in KV: ${source}`)
    }

    // Get template engine
    const templateEngine = this.engines.get(engine)
    if (!templateEngine) {
      throw new Error(`Template engine '${engine}' not found`)
    }

    // Compile template
    const renderFn = templateEngine.compile(templateContent)
    const template = new StringTemplate(source, engine, renderFn)

    // Cache locally
    this.localCache.set(cacheKey, { template, timestamp: Date.now() })

    return template
  }

  /**
   * Sync load not supported for KV (always async)
   */
  loadSync(source: string, engine: 'native' | 'handlebars' | 'liquid'): Template {
    throw new Error('Synchronous template loading not supported in CloudFlare Workers. Use load() instead.')
  }

  /**
   * Register a template engine
   */
  registerEngine(engine: TemplateEngine): void {
    this.engines.set(engine.name, engine)
  }

  /**
   * Store template in KV (for deployment/upload)
   */
  async store(source: string, content: string): Promise<void> {
    const kvKey = `${this.keyPrefix}${source}`
    await this.kv.put(kvKey, content, {
      expirationTtl: this.cacheTtl
    })
  }

  /**
   * Clear local cache
   */
  clearLocalCache(): void {
    this.localCache.clear()
  }

  /**
   * Invalidate specific template from local cache
   */
  invalidate(source: string, engine?: string): void {
    if (engine) {
      this.localCache.delete(`${source}:${engine}`)
    } else {
      // Invalidate all engines for this source
      const engines = ['native', 'handlebars', 'liquid']
      engines.forEach(eng => {
        this.localCache.delete(`${source}:${eng}`)
      })
    }
  }
}
