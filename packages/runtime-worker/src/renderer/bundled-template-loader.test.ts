import { describe, expect, it } from 'vitest'
import { BundledTemplateLoader } from './bundled-template-loader.js'

describe('BundledTemplateLoader', () => {
  it('loads imported file contents synchronously by Blueprint source path', () => {
    const loader = new BundledTemplateLoader({
      templates: { 'templates/card.liquid': '<h1>{{ page.title }}</h1>' },
    })

    const template = loader.loadSync('templates/card.liquid', 'liquid')
    expect(template.render({ page: { title: 'Edge' } } as any)).toBe('<h1>Edge</h1>')
  })

  it('reports the missing Blueprint source path', () => {
    const loader = new BundledTemplateLoader({ templates: {} })
    expect(() => loader.loadSync('templates/missing.liquid', 'liquid'))
      .toThrow('Bundled template not found: templates/missing.liquid')
  })
})
