/**
 * Liquid Template Engine
 *
 * Liquid template engine adapter for Zebric.
 * Works on both Node.js and CloudFlare Workers.
 *
 * Note: Requires 'liquidjs' package to be installed separately.
 */

import type { TemplateEngine } from './template-system.js'
import type { RenderContext } from '../routing/request-ports.js'

/**
 * Liquid template engine
 */
export class LiquidEngine implements TemplateEngine {
  readonly name = 'liquid' as const
  private liquid: any

  constructor(liquid?: any) {
    // Liquid instance must be provided (to avoid platform-specific imports)
    if (!liquid) {
      throw new Error(
        'Liquid instance required. Pass it to the constructor or install with: npm install liquidjs'
      )
    }
    this.liquid = liquid
  }

  /**
   * Compile Liquid template
   */
  compile(source: string): (context: RenderContext) => string {
    // Liquid templates are parsed, not compiled
    // We return a function that renders the template
    return (context: RenderContext) => {
      // Flatten context for Liquid
      const liquidContext = {
        page: context.page,
        data: context.data,
        params: context.params,
        query: context.query,
        session: context.session,
        csrfToken: context.csrfToken,
        // Convenience helpers
        user: context.session?.user,
        isAuthenticated: !!context.session,
      }

      // Liquid render is async, but we need sync for compatibility
      // For now, we'll use parseAndRenderSync if available
      try {
        if (this.liquid.parseAndRenderSync) {
          return this.liquid.parseAndRenderSync(source, liquidContext)
        } else {
          // Fallback: this is async, but we can't handle it here
          throw new Error('Liquid engine requires synchronous rendering. Use parseAndRenderSync.')
        }
      } catch (error) {
        throw new Error(`Liquid template error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /**
   * Register a Liquid filter
   */
  registerFilter(name: string, fn: (...args: any[]) => any): void {
    this.liquid.registerFilter(name, fn)
  }

  /**
   * Register a Liquid tag
   */
  registerTag(name: string, tag: any): void {
    this.liquid.registerTag(name, tag)
  }

  /**
   * Get the underlying Liquid instance
   */
  getLiquid(): any {
    return this.liquid
  }
}

/**
 * Create Liquid engine with common filters
 */
export function createLiquidEngine(liquid?: any): LiquidEngine {
  const engine = new LiquidEngine(liquid)

  // Register common filters
  engine.registerFilter('formatDate', (date: string | Date, format?: string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    if (!d || isNaN(d.getTime())) return ''

    switch (format) {
      case 'short':
        return d.toLocaleDateString()
      case 'long':
        return d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      case 'time':
        return d.toLocaleTimeString()
      case 'datetime':
        return d.toLocaleString()
      default:
        return d.toISOString()
    }
  })

  engine.registerFilter('json', (obj: any) => JSON.stringify(obj, null, 2))

  return engine
}
