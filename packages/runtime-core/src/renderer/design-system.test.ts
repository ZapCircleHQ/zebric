import { describe, expect, it } from 'vitest'
import { renderDesignSystemStyles, resolveDesignSystem, withDesignSystemTheme } from './design-system.js'
import { defaultTheme } from './theme.js'

describe('Zazzle design systems', () => {
  it('uses modern semantic tokens by default', () => {
    const system = resolveDesignSystem()

    expect(system.name).toBe('modern')
    expect(system.tokens['color-primary']).toBe('#171717')
    expect(system.css).toContain('--zb-surface-card:#ffffff')
  })

  it('provides four distinct built-in systems', () => {
    const systems = ['modern', 'classic', 'friendly', 'minimal'] as const
    const radii = systems.map(name => resolveDesignSystem({ name }).tokens['radius-small'])
    const bodyFonts = systems.map(name => resolveDesignSystem({ name }).tokens['font-family-body'])
    const headingSizes = systems.map(name => resolveDesignSystem({ name }).tokens['font-size-heading-large'])

    expect(new Set(radii).size).toBe(4)
    expect(new Set(bodyFonts).size).toBe(4)
    expect(new Set(headingSizes).size).toBe(4)
  })

  it('allows a custom system to inherit and override a built-in', () => {
    const system = resolveDesignSystem({
      name: 'acme',
      extends: 'modern',
      tokens: {
        '--zb-color-primary': '#ff0066',
        'radius-small': '1rem',
      },
      css: ['/styles/acme-layout.css', '/styles/acme-components.css'],
    })

    expect(system.base).toBe('modern')
    expect(system.tokens['surface-default']).toBe('#fafafa')
    expect(system.css).toContain('--zb-color-primary:#ff0066')
    expect(system.css).toContain('--zb-radius-small:1rem')
    expect(system.stylesheets).toHaveLength(2)
  })

  it('connects existing renderer theme slots to semantic CSS classes', () => {
    const theme = withDesignSystemTheme(defaultTheme)

    expect(theme.body).toContain('zb-body')
    expect(theme.heading1).toContain('zb-heading-large')
    expect(theme.heading2).toContain('zb-heading-medium')
    expect(theme.heading3).toContain('zb-heading-small')
    expect(theme.card).toContain('zb-surface-card')
    expect(theme.buttonPrimary).toContain('zb-button-primary')
    expect(theme.linkPrimary).toContain('zb-link-primary')
    expect(theme.input).toContain('zb-control')
  })

  it('adds semantic classes idempotently', () => {
    const theme = withDesignSystemTheme(withDesignSystemTheme(defaultTheme))

    expect(theme.heading1.split(/\s+/).filter(value => value === 'zb-heading')).toHaveLength(1)
    expect(theme.heading1.split(/\s+/).filter(value => value === 'zb-heading-large')).toHaveLength(1)
  })

  it('emits typography tokens and consumes them in component CSS', () => {
    const system = resolveDesignSystem({ name: 'friendly' })

    expect(system.css).toContain('--zb-font-family-body:ui-rounded, "Nunito Sans", system-ui, sans-serif')
    expect(system.css).toContain('--zb-font-size-heading-large:2.125rem')
    expect(system.css).toContain('font-family:var(--zb-font-family-body)')
    expect(system.css).toContain('.zb-heading-large{font-size:var(--zb-font-size-heading-large)}')
  })

  it('renders an already-resolved system without changing it', () => {
    const resolved = resolveDesignSystem({ name: 'friendly' })
    const html = renderDesignSystemStyles(resolved)

    expect(html).toContain('data-name="friendly"')
    expect(html).toContain('--zb-color-primary:#6d4aff')
  })

  it('supports a custom system from scratch', () => {
    const system = resolveDesignSystem({
      name: 'bare',
      tokens: { 'color-primary': 'rebeccapurple' },
    })

    expect(system.base).toBeUndefined()
    expect(system.tokens).toEqual({ 'color-primary': 'rebeccapurple' })
  })

  it('gives each built-in a dark-mode override scoped to its own name', () => {
    const systems = ['modern', 'classic', 'friendly', 'minimal'] as const

    for (const name of systems) {
      const system = resolveDesignSystem({ name })
      expect(system.css).toContain(`html[data-zebric-design-system="${name}"][data-zebric-resolved-color-mode="dark"]`)
      expect(system.css).toContain('color-scheme:dark')
    }

    const darkBlocks = systems.map(name => {
      const css = resolveDesignSystem({ name }).css
      return css.slice(css.indexOf(`data-zebric-design-system="${name}"][data-zebric-resolved-color-mode="dark"`))
    })
    expect(new Set(darkBlocks.map(block => block.slice(0, 200))).size).toBe(4)
  })

  it('keeps dark-mode button text and link/focus color legible against inverted primaries', () => {
    const minimal = resolveDesignSystem({ name: 'minimal' })

    // minimal's light-mode color-primary is black; dark mode must not keep
    // white button text on a (now white) primary background.
    expect(minimal.tokens['color-primary']).toBe('#000000')
    expect(minimal.tokens['text-on-primary']).toBe('#ffffff')
    expect(minimal.css).toContain('--zb-color-primary:#ffffff')
    expect(minimal.css).toContain('--zb-text-on-primary:#000000')
  })

  it('gives a custom system extending a built-in that built-in\'s dark palette, scoped by its own name', () => {
    const system = resolveDesignSystem({ name: 'acme', extends: 'classic' })

    expect(system.css).toContain('html[data-zebric-design-system="acme"][data-zebric-resolved-color-mode="dark"]')
    expect(system.css).toContain('--zb-surface-default:#1c1815')
  })

  it('falls back to a generic dark palette for a from-scratch custom system', () => {
    const system = resolveDesignSystem({ name: 'bare', tokens: { 'color-primary': 'rebeccapurple' } })

    expect(system.css).toContain('html[data-zebric-design-system="bare"][data-zebric-resolved-color-mode="dark"]{color-scheme:dark;--zb-surface-default:#111827')
  })

  it('rejects an unsafe design system name in the dark-mode selector', () => {
    const system = resolveDesignSystem({ name: 'acme"] </style><script>alert(1)</script>', extends: 'modern' })

    expect(system.css).not.toContain('<script>')
    expect(system.css).toContain('html[data-zebric-resolved-color-mode="dark"]{color-scheme:dark;--zb-color-primary:#e5e5e5')
  })

  it('routes primary-color text and button-text through dedicated tokens for dark-mode contrast', () => {
    const system = resolveDesignSystem({ name: 'modern' })

    expect(system.css).toContain('.zb-link-primary,.zb-link-primary:hover{color:var(--zb-color-primary-text)}')
    expect(system.css).toContain('.zb-control:focus{border-color:var(--zb-color-primary-text)')
    expect(system.css).toContain('color:var(--zb-text-on-primary)')
  })

  it('escapes stylesheet paths and rejects token injection', () => {
    const html = renderDesignSystemStyles({
      name: 'safe',
      css: ['styles/app.css" onload="alert(1)'],
      tokens: {
        'color-primary': 'red;} </style><script>alert(1)</script>',
        'invalid token': 'blue',
      },
    })

    expect(html).toContain('styles/app.css&quot; onload=&quot;alert(1)')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('--zb-invalid token')
  })
})
