/**
 * Template System
 *
 * Platform-agnostic template interfaces for Zebric.
 * Supports multiple template engines (native, Handlebars, Liquid) across Node and Workers.
 */

import type { RenderContext } from '../routing/request-ports.js'

/**
 * Template interface
 */
export interface Template {
  name: string
  engine: 'native' | 'handlebars' | 'liquid'
  render(context: RenderContext): string
}

/**
 * Template registry interface
 */
export interface TemplateRegistry {
  get(name: string): Template | undefined
  set(name: string, template: Template): void
  has(name: string): boolean
  delete(name: string): boolean
  clear(): void
}

/**
 * Template loader interface
 */
export interface TemplateLoader {
  load(source: string, engine: 'native' | 'handlebars' | 'liquid'): Promise<Template>
  loadSync?(source: string, engine: 'native' | 'handlebars' | 'liquid'): Template
}

/**
 * Template engine interface
 */
export interface TemplateEngine {
  name: 'native' | 'handlebars' | 'liquid'
  compile(source: string): (context: RenderContext) => string
}

/**
 * Memory-based template registry
 */
export class MemoryTemplateRegistry implements TemplateRegistry {
  private templates = new Map<string, Template>()

  get(name: string): Template | undefined {
    return this.templates.get(name)
  }

  set(name: string, template: Template): void {
    this.templates.set(name, template)
  }

  has(name: string): boolean {
    return this.templates.has(name)
  }

  delete(name: string): boolean {
    return this.templates.delete(name)
  }

  clear(): void {
    this.templates.clear()
  }

  size(): number {
    return this.templates.size
  }
}

/**
 * String-based template implementation
 */
export class StringTemplate implements Template {
  constructor(
    public name: string,
    public engine: 'native' | 'handlebars' | 'liquid',
    private renderFn: (context: RenderContext) => string
  ) {}

  render(context: RenderContext): string {
    return this.renderFn(context)
  }
}

/**
 * Native template engine using template literals
 */
export class NativeTemplateEngine implements TemplateEngine {
  readonly name = 'native' as const

  compile(source: string): (context: RenderContext) => string {
    // Use Function constructor to create a template function
    // The template has access to 'context' variable
    return new Function('context', `return \`${source}\`;`) as (context: RenderContext) => string
  }
}

/**
 * Inline template loader
 * Loads templates from strings (useful for Workers)
 */
export class InlineTemplateLoader implements TemplateLoader {
  constructor(
    private engines: Map<string, TemplateEngine> = new Map([
      ['native', new NativeTemplateEngine()]
    ])
  ) {}

  async load(source: string, engine: 'native' | 'handlebars' | 'liquid'): Promise<Template> {
    return this.loadSync(source, engine)
  }

  loadSync(source: string, engine: 'native' | 'handlebars' | 'liquid'): Template {
    const templateEngine = this.engines.get(engine)
    if (!templateEngine) {
      throw new Error(`Template engine '${engine}' not found`)
    }

    const renderFn = templateEngine.compile(source)
    return new StringTemplate(`inline:${engine}`, engine, renderFn)
  }

  registerEngine(engine: TemplateEngine): void {
    this.engines.set(engine.name, engine)
  }
}
