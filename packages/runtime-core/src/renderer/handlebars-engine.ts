/**
 * Handlebars Template Engine
 *
 * Handlebars template engine adapter for Zebric.
 * Works on both Node.js and CloudFlare Workers.
 *
 * Note: Requires 'handlebars' package to be installed separately.
 */

import type { TemplateEngine } from './template-system.js'
import type { RenderContext } from '../routing/request-ports.js'

/**
 * Handlebars template engine
 */
export class HandlebarsEngine implements TemplateEngine {
  readonly name = 'handlebars' as const
  private handlebars: any

  constructor(handlebars?: any) {
    // Handlebars instance must be provided (to avoid platform-specific imports)
    if (!handlebars) {
      throw new Error(
        'Handlebars instance required. Pass it to the constructor or install with: npm install handlebars'
      )
    }
    this.handlebars = handlebars
  }

  /**
   * Compile Handlebars template
   */
  compile(source: string): (context: RenderContext) => string {
    const template = this.handlebars.compile(source)

    return (context: RenderContext) => {
      // Flatten context for Handlebars
      const handlebarsContext = {
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

      return template(handlebarsContext)
    }
  }

  /**
   * Register a Handlebars helper
   */
  registerHelper(name: string, fn: (...args: any[]) => any): void {
    this.handlebars.registerHelper(name, fn)
  }

  /**
   * Register a Handlebars partial
   */
  registerPartial(name: string, partial: string): void {
    this.handlebars.registerPartial(name, partial)
  }

  /**
   * Get the underlying Handlebars instance
   */
  getHandlebars(): any {
    return this.handlebars
  }
}

/**
 * Create Handlebars engine with common helpers
 */
export function createHandlebarsEngine(handlebars?: any): HandlebarsEngine {
  const engine = new HandlebarsEngine(handlebars)

  // Register common helpers
  engine.registerHelper('eq', (a: any, b: any) => a === b)
  engine.registerHelper('neq', (a: any, b: any) => a !== b)
  engine.registerHelper('gt', (a: number, b: number) => a > b)
  engine.registerHelper('gte', (a: number, b: number) => a >= b)
  engine.registerHelper('lt', (a: number, b: number) => a < b)
  engine.registerHelper('lte', (a: number, b: number) => a <= b)
  engine.registerHelper('and', (...args: any[]) => {
    // Handlebars passes options as last argument
    const options = args.pop()
    return args.every(Boolean)
  })
  engine.registerHelper('or', (...args: any[]) => {
    const options = args.pop()
    return args.some(Boolean)
  })
  engine.registerHelper('not', (value: any) => !value)

  // Date formatting helper
  engine.registerHelper('formatDate', (date: string | Date, format?: string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    if (!d || isNaN(d.getTime())) return ''

    // Simple format options
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

  // JSON stringify helper
  engine.registerHelper('json', (obj: any) => JSON.stringify(obj, null, 2))

  // Length helper
  engine.registerHelper('length', (arr: any[]) => Array.isArray(arr) ? arr.length : 0)

  return engine
}
