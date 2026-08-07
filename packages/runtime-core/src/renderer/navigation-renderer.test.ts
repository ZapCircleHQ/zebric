import { describe, expect, it } from 'vitest'
import { defaultTheme } from './theme.js'
import { renderNavigation, resolveNavPages, resolveNotificationPath } from './navigation-renderer.js'
import type { Blueprint } from '../types/blueprint.js'

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    version: '1.0',
    project: { name: 'Dispatch', version: '1.0.0', runtime: { min_version: '0.1.0' } },
    entities: [],
    pages: [
      { path: '/', title: 'Dispatch', layout: 'dashboard' },
      { path: '/issues', title: 'Issues', layout: 'list' },
      { path: '/board', title: 'Board', layout: 'dashboard' },
      { path: '/issues/:id', title: 'Issue', layout: 'detail' },
    ],
    ...overrides,
  } as any
}

describe('navigation renderer', () => {
  it('resolves primary nav pages in configured order', () => {
    const pages = resolveNavPages(makeBlueprint({
      ux: { navigation: { primary: ['Board', 'Issues'] } },
    }))

    expect(pages.map(page => page.path)).toEqual(['/board', '/issues'])
  })

  it('omits dynamic pages from default navigation', () => {
    const pages = resolveNavPages(makeBlueprint())
    expect(pages.map(page => page.path)).toEqual(['/issues', '/board'])
  })

  it('renders no navigation when model is none', () => {
    const html = renderNavigation(makeBlueprint({
      ux: { navigation: { model: 'none' } },
    }), defaultTheme).toString()

    expect(html).toBe('')
  })

  it('marks the current page', () => {
    const html = renderNavigation(makeBlueprint(), defaultTheme, null, '/issues').toString()
    expect(html).toContain('aria-current="page"')
  })

  it('renders the color mode and signed-in account actions', () => {
    const html = renderNavigation(makeBlueprint(), defaultTheme, {
      user: { name: 'Ada Lovelace', email: 'ada@example.com' },
    }, '/issues').toString()

    expect(html).toContain('data-zebric-color-mode-control')
    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('/auth/sign-out?callbackURL=%2Fissues')
  })

  it('resolves and renders an app-owned notification destination', () => {
    const blueprint = makeBlueprint({
      pages: [...makeBlueprint().pages, { path: '/activity', title: 'Recent activity', layout: 'list' }],
    })

    expect(resolveNotificationPath(blueprint)).toBe('/activity')
    const html = renderNavigation(blueprint, defaultTheme, { user: { name: 'Ada' } }).toString()
    expect(html).toContain('aria-label="Notifications"')
    expect(html).toContain('href="/activity"')
  })

  it('does not render a dead notification link', () => {
    const html = renderNavigation(makeBlueprint(), defaultTheme, { user: { name: 'Ada' } }).toString()
    expect(resolveNotificationPath(makeBlueprint())).toBeUndefined()
    expect(html).not.toContain('aria-label="Notifications"')
  })
})
