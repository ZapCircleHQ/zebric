import { describe, it, expect } from 'vitest'
import { Liquid } from 'liquidjs'
import { createLiquidEngine, LiquidEngine } from './liquid-engine.js'

const render = (source: string, context: Record<string, any> = {}) =>
  createLiquidEngine().compile(source)(context as any)

describe('LiquidEngine', () => {
  it('requires a Liquid instance', () => {
    expect(() => new LiquidEngine()).toThrow(/Liquid instance required/)
  })

  it('renders variables and exposes user/isAuthenticated helpers', () => {
    const out = render('{{ title }}|{{ user.name }}|{{ isAuthenticated }}', {
      title: 'Hello',
      session: { user: { name: 'Ada' } },
    })
    expect(out).toBe('Hello|Ada|true')
  })

  it('reports isAuthenticated=false without a session', () => {
    expect(render('{{ isAuthenticated }}', {})).toBe('false')
  })

  it('wraps template errors with a recognisable prefix', () => {
    expect(() => render('{% for %}', {})).toThrow(/Liquid template error/)
  })

  it('throws when the Liquid instance has no sync renderer', () => {
    const engine = new LiquidEngine({})
    expect(() => engine.compile('x')({} as any)).toThrow(/synchronous rendering/)
  })
})

describe('createLiquidEngine filters', () => {
  it('formatDate handles formats and invalid input', () => {
    expect(render('{{ d | formatDate }}', { d: '2024-01-02T03:04:05.000Z' })).toBe(
      '2024-01-02T03:04:05.000Z'
    )
    expect(render('{{ d | formatDate: "long" }}', { d: '2024-06-15T12:00:00Z' })).toMatch(/2024/)
    expect(render('{{ d | formatDate }}', { d: 'not a date' })).toBe('')
  })

  it('json filter serialises (and is escaped by default)', () => {
    expect(render('{{ o | json }}', { o: { a: 1 } })).toBe('{\n  &#34;a&#34;: 1\n}')
  })
})

describe('security', () => {
  it('auto-escapes output by default', () => {
    expect(render('{{ x }}', { x: '<script>alert(1)</script>' })).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    )
  })

  it('allows opting out of escaping with the raw filter', () => {
    expect(render('{{ x | raw }}', { x: '<b>hi</b>' })).toBe('<b>hi</b>')
  })

  it('does not expose prototype properties of context objects', () => {
    const out = render('{{ o.constructor.name }}|{{ o.__proto__ }}|{{ o.toString }}', { o: { a: 1 } })
    expect(out).toBe('||')
  })

  it('does not allow reaching Function via constructor chains', () => {
    const out = render('{{ o.constructor.constructor }}', { o: { a: 1 } })
    expect(out).toBe('')
  })

  it('does not expose inherited array indices (ownPropertyOnly)', () => {
    const proto = ['secret']
    const inherited = Object.create(proto)
    const out = render('{{ a | first }}|{{ a[0] }}', { a: inherited })
    expect(out).not.toContain('secret')
  })

  it('does not expose inherited properties inside {% render %} partials', () => {
    const liquid = new Liquid({
      outputEscape: 'escape',
      ownPropertyOnly: true,
      templates: { partial: '{{ o.inherited }}' },
    })
    const o = Object.create({ inherited: 'leaked' })
    const out = createLiquidEngine(liquid).compile('{% render "partial", o: o %}')({ o } as any)
    expect(out).not.toContain('leaked')
  })

  it('bounds runaway loops when render limits are configured', () => {
    const liquid = new Liquid({ renderLimit: 50, memoryLimit: 1e6 })
    const engine = createLiquidEngine(liquid)
    const tpl = '{% for i in (1..100000000) %}{% endfor %}'
    expect(() => engine.compile(tpl)({} as any)).toThrow(/Liquid template error/)
  })

  it('enforces memoryLimit on join/pop filters', () => {
    const liquid = new Liquid({ memoryLimit: 1000 })
    const engine = createLiquidEngine(liquid)
    const big = Array.from({ length: 5000 }, () => 'xxxxxxxxxx')
    expect(() => engine.compile('{{ a | join: "-" }}')({ a: big } as any)).toThrow(
      /Liquid template error/
    )
  })

  it('strip_html does not leave tags split across newlines', () => {
    const out = render('{{ x | strip_html | raw }}', { x: '<img\nsrc=x onerror=alert(1)>ok' })
    expect(out).not.toContain('onerror')
  })

  it('strip_html completes quickly on pathological input', () => {
    const start = Date.now()
    render('{{ x | strip_html }}', { x: '<' + 'a '.repeat(20000) })
    expect(Date.now() - start).toBeLessThan(2000)
  })
})
