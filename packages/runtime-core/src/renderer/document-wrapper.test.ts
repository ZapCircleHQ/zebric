import { describe, expect, it } from 'vitest'
import { DocumentWrapper } from './document-wrapper.js'
import { defaultTheme } from './theme.js'
import { safe } from '../security/html-escape.js'
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

describe('DocumentWrapper Zazzle rendering', () => {
  it('uses configured navigation model and primary nav items', () => {
    const wrapper = new DocumentWrapper(makeBlueprint({
      ux: {
        navigation: {
          model: 'sidebar',
          primary: ['Dispatch', 'Issues'],
        },
      },
    }), defaultTheme)

    const html = wrapper.wrapInDocument('Issues', safe('<p>Content</p>'), null, '/issues')

    expect(html).toContain('data-zebric-navigation-model="sidebar"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('href="/issues"')
    expect(html).not.toContain('href="/board"')
    expect(html).not.toContain('href="/issues/:id"')
  })

  it('omits navigation when configured as none', () => {
    const wrapper = new DocumentWrapper(makeBlueprint({
      ux: { navigation: { model: 'none' } },
    }), defaultTheme)

    const html = wrapper.wrapInDocument('Issues', safe('<p>Content</p>'), null, '/issues')

    expect(html).not.toContain('Primary navigation')
  })

  it('renders success flash as toast from system feedback config', () => {
    const wrapper = new DocumentWrapper(makeBlueprint({
      ux: {
        system: {
          feedback: {
            success: 'toast',
            error: 'inline',
          },
        },
      },
    }), defaultTheme)

    const html = wrapper.wrapInDocument(
      'Issues',
      safe('<p>Content</p>'),
      null,
      '/issues',
      { type: 'success', text: 'Saved.' }
    )

    expect(html).toContain('data-zebric-feedback="toast"')
    expect(html).toContain('fixed right-4 top-4')
    expect(html).toContain('Saved.')
  })
})
