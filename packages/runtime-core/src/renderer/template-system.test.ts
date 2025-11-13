/**
 * Template System Integration Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryTemplateRegistry, InlineTemplateLoader, StringTemplate } from './template-system.js'
import type { RenderContext } from '../routing/request-ports.js'

describe('MemoryTemplateRegistry', () => {
  let registry: MemoryTemplateRegistry

  beforeEach(() => {
    registry = new MemoryTemplateRegistry()
  })

  it('should store and retrieve templates', () => {
    const template = new StringTemplate('test', 'liquid', () => '<div>test</div>')

    registry.set('test-template', template)

    const retrieved = registry.get('test-template')
    expect(retrieved).toBe(template)
  })

  it('should check if template exists', () => {
    const template = new StringTemplate('test', 'liquid', () => '<div>test</div>')

    registry.set('test-template', template)

    expect(registry.has('test-template')).toBe(true)
    expect(registry.has('nonexistent')).toBe(false)
  })

  it('should delete templates', () => {
    const template = new StringTemplate('test', 'liquid', () => '<div>test</div>')

    registry.set('test-template', template)
    expect(registry.has('test-template')).toBe(true)

    registry.delete('test-template')
    expect(registry.has('test-template')).toBe(false)
  })

  it('should clear all templates', () => {
    registry.set('template1', new StringTemplate('t1', 'liquid', () => 'test1'))
    registry.set('template2', new StringTemplate('t2', 'liquid', () => 'test2'))

    expect(registry.size()).toBe(2)

    registry.clear()
    expect(registry.size()).toBe(0)
  })
})

describe('InlineTemplateLoader', () => {
  let loader: InlineTemplateLoader

  beforeEach(() => {
    loader = new InlineTemplateLoader()
  })

  it('should load liquid template synchronously', () => {
    const source = '<div>${context.page.title}</div>'
    const template = loader.loadSync(source, 'liquid')

    expect(template).toBeDefined()
    expect(template.engine).toBe('liquid')
  })

  it('should load liquid template asynchronously', async () => {
    const source = '<div>{{ page.title }}</div>'
    const template = await loader.load(source, 'liquid')

    expect(template).toBeDefined()
    expect(template.engine).toBe('liquid')
  })

  it('should render loaded template', () => {
    const source = '<h1>{{ page.title }}</h1>'
    const template = loader.loadSync(source, 'liquid')

    const context: RenderContext = {
      page: { path: '/', title: 'Home', layout: 'list' },
      data: {},
      params: {},
      query: {}
    }

    const result = template.render(context)
    expect(result).toBe('<h1>Home</h1>')
  })

  it('should throw error for unsupported engine', () => {
    expect(() => {
      loader.loadSync('<div>test</div>', 'handlebars')
    }).toThrow("Template engine 'handlebars' not found")
  })

  it('should allow registering custom engine', () => {
    const customEngine = {
      name: 'handlebars' as const,
      compile: (source: string) => {
        return () => `CUSTOM: ${source}`
      }
    }

    loader.registerEngine(customEngine)

    const template = loader.loadSync('test', 'handlebars')
    const result = template.render({} as RenderContext)

    expect(result).toBe('CUSTOM: test')
  })
})

describe('StringTemplate', () => {
  it('should store and render template', () => {
    const renderFn = (context: RenderContext) => `Hello ${context.page.title}`
    const template = new StringTemplate('greeting', 'liquid', renderFn)

    const context: RenderContext = {
      page: { path: '/', title: 'World', layout: 'list' },
      data: {},
      params: {},
      query: {}
    }

    expect(template.name).toBe('greeting')
    expect(template.engine).toBe('liquid')
    expect(template.render(context)).toBe('Hello World')
  })

  it('should handle complex rendering logic', () => {
    const renderFn = (context: RenderContext) => {
      const items = context.data.items || []
      return `<ul>${items.map((i: any) => `<li>${i.name}</li>`).join('')}</ul>`
    }

    const template = new StringTemplate('list', 'liquid', renderFn)

    const context: RenderContext = {
      page: { path: '/', title: 'List', layout: 'list' },
      data: { items: [{ name: 'A' }, { name: 'B' }] },
      params: {},
      query: {}
    }

    const result = template.render(context)
    expect(result).toBe('<ul><li>A</li><li>B</li></ul>')
  })
})

describe('Template System Integration', () => {
  it('should work end-to-end with registry and loader', async () => {
    const registry = new MemoryTemplateRegistry()
    const loader = new InlineTemplateLoader()

    // Load template
    const source = '<div class="product"><h2>{{ data.name }}</h2><p>${{ data.price }}</p></div>'
    const template = await loader.load(source, 'liquid')

    // Register template
    registry.set('product-card', template)

    // Retrieve and render
    const retrieved = registry.get('product-card')
    expect(retrieved).toBeDefined()

    const context: RenderContext = {
      page: { path: '/products', title: 'Products', layout: 'list' },
      data: { name: 'Widget', price: 19.99 },
      params: {},
      query: {}
    }

    const result = retrieved!.render(context)
    expect(result).toContain('<h2>Widget</h2>')
    expect(result).toContain('<p>$19.99</p>')
  })

  it('should handle multiple templates in registry', async () => {
    const registry = new MemoryTemplateRegistry()
    const loader = new InlineTemplateLoader()

    // Load multiple templates
    const headerTemplate = await loader.load('<header>{{ page.title }}</header>', 'liquid')
    const footerTemplate = await loader.load('<footer>© 2025</footer>', 'liquid')

    registry.set('header', headerTemplate)
    registry.set('footer', footerTemplate)

    const context: RenderContext = {
      page: { path: '/', title: 'Home', layout: 'list' },
      data: {},
      params: {},
      query: {}
    }

    const header = registry.get('header')!.render(context)
    const footer = registry.get('footer')!.render(context)

    expect(header).toBe('<header>Home</header>')
    expect(footer).toBe('<footer>© 2025</footer>')
  })
})
