/**
 * Template System Integration Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MemoryTemplateRegistry,
  InlineTemplateLoader,
  NativeTemplateEngine,
  StringTemplate
} from './template-system.js'
import type { RenderContext } from '../routing/request-ports.js'

describe('MemoryTemplateRegistry', () => {
  let registry: MemoryTemplateRegistry

  beforeEach(() => {
    registry = new MemoryTemplateRegistry()
  })

  it('should store and retrieve templates', () => {
    const template = new StringTemplate('test', 'native', () => '<div>test</div>')

    registry.set('test-template', template)

    const retrieved = registry.get('test-template')
    expect(retrieved).toBe(template)
  })

  it('should check if template exists', () => {
    const template = new StringTemplate('test', 'native', () => '<div>test</div>')

    registry.set('test-template', template)

    expect(registry.has('test-template')).toBe(true)
    expect(registry.has('nonexistent')).toBe(false)
  })

  it('should delete templates', () => {
    const template = new StringTemplate('test', 'native', () => '<div>test</div>')

    registry.set('test-template', template)
    expect(registry.has('test-template')).toBe(true)

    registry.delete('test-template')
    expect(registry.has('test-template')).toBe(false)
  })

  it('should clear all templates', () => {
    registry.set('template1', new StringTemplate('t1', 'native', () => 'test1'))
    registry.set('template2', new StringTemplate('t2', 'native', () => 'test2'))

    expect(registry.size()).toBe(2)

    registry.clear()
    expect(registry.size()).toBe(0)
  })
})

describe('NativeTemplateEngine', () => {
  let engine: NativeTemplateEngine
  let mockContext: RenderContext

  beforeEach(() => {
    engine = new NativeTemplateEngine()
    mockContext = {
      page: { path: '/test', title: 'Test Page', layout: 'list' },
      data: { items: [{ name: 'Item 1' }, { name: 'Item 2' }] },
      params: { id: '123' },
      query: { search: 'test' },
      session: {
        id: 'session-123',
        userId: 'user-456',
        user: { id: 'user-456', name: 'Test User' },
        expiresAt: new Date(),
        createdAt: new Date()
      }
    }
  })

  it('should compile and execute simple template', () => {
    const renderFn = engine.compile('<div>${context.page.title}</div>')
    const result = renderFn(mockContext)

    expect(result).toBe('<div>Test Page</div>')
  })

  it('should access nested context properties', () => {
    const renderFn = engine.compile('<p>${context.session.user.name}</p>')
    const result = renderFn(mockContext)

    expect(result).toBe('<p>Test User</p>')
  })

  it('should handle array mapping', () => {
    const template = `
      <ul>
        \${context.data.items.map(item => \`<li>\${item.name}</li>\`).join('')}
      </ul>
    `
    const renderFn = engine.compile(template)
    const result = renderFn(mockContext)

    expect(result).toContain('<li>Item 1</li>')
    expect(result).toContain('<li>Item 2</li>')
  })

  it('should handle conditional rendering', () => {
    const template = '\${context.session ? "Logged in" : "Guest"}'
    const renderFn = engine.compile(template)
    const result = renderFn(mockContext)

    expect(result).toBe('Logged in')
  })

  it('should handle template with no context access', () => {
    const renderFn = engine.compile('<div>Static content</div>')
    const result = renderFn(mockContext)

    expect(result).toBe('<div>Static content</div>')
  })
})

describe('InlineTemplateLoader', () => {
  let loader: InlineTemplateLoader

  beforeEach(() => {
    loader = new InlineTemplateLoader()
  })

  it('should load native template synchronously', () => {
    const source = '<div>${context.page.title}</div>'
    const template = loader.loadSync(source, 'native')

    expect(template).toBeDefined()
    expect(template.engine).toBe('native')
  })

  it('should load native template asynchronously', async () => {
    const source = '<div>${context.page.title}</div>'
    const template = await loader.load(source, 'native')

    expect(template).toBeDefined()
    expect(template.engine).toBe('native')
  })

  it('should render loaded template', () => {
    const source = '<h1>${context.page.title}</h1>'
    const template = loader.loadSync(source, 'native')

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
      name: 'custom' as const,
      compile: (source: string) => {
        return () => `CUSTOM: ${source}`
      }
    }

    loader.registerEngine(customEngine)

    const template = loader.loadSync('test', 'custom' as any)
    const result = template.render({} as RenderContext)

    expect(result).toBe('CUSTOM: test')
  })
})

describe('StringTemplate', () => {
  it('should store and render template', () => {
    const renderFn = (context: RenderContext) => `Hello ${context.page.title}`
    const template = new StringTemplate('greeting', 'native', renderFn)

    const context: RenderContext = {
      page: { path: '/', title: 'World', layout: 'list' },
      data: {},
      params: {},
      query: {}
    }

    expect(template.name).toBe('greeting')
    expect(template.engine).toBe('native')
    expect(template.render(context)).toBe('Hello World')
  })

  it('should handle complex rendering logic', () => {
    const renderFn = (context: RenderContext) => {
      const items = context.data.items || []
      return `<ul>${items.map((i: any) => `<li>${i.name}</li>`).join('')}</ul>`
    }

    const template = new StringTemplate('list', 'native', renderFn)

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
    const source = '<div class="product"><h2>${context.data.name}</h2><p>$${context.data.price}</p></div>'
    const template = await loader.load(source, 'native')

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
    const headerTemplate = await loader.load('<header>${context.page.title}</header>', 'native')
    const footerTemplate = await loader.load('<footer>© 2025</footer>', 'native')

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
