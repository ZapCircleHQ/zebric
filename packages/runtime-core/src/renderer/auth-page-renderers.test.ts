import { describe, expect, it } from 'vitest'
import type { Blueprint } from '../types/blueprint.js'
import { HTMLRenderer } from './html-renderer.js'

function blueprint(auth: Blueprint['auth'] = { providers: ['email'] }): Blueprint {
  return {
    version: '0.1.0',
    project: {
      name: 'Auth test',
      version: '0.1.0',
      runtime: { min_version: '0.1.0' },
    },
    entities: [],
    pages: [],
    auth,
  }
}

describe('auth page rendering', () => {
  it('submits the CSRF token rendered from the safe page request', () => {
    const html = new HTMLRenderer(blueprint()).renderSignInPage(
      'http://localhost:3000/board',
      undefined,
      'csrf-test-token',
    )

    expect(html).toContain('name="_csrf" value="csrf-test-token"')
    expect(html).toContain("'x-csrf-token': csrfInput.value")
  })

  it('uses a blueprint-provided inline sign-in template', () => {
    const html = new HTMLRenderer(blueprint({
      providers: ['email'],
      pages: {
        signIn: {
          engine: 'liquid',
          type: 'inline',
          source: '<h1>Branded login</h1><span>{{ auth.csrfToken }}</span>{{ renderer.script | raw }}',
        },
      },
    })).renderSignInPage('/', undefined, 'custom-csrf')

    expect(html).toContain('<h1>Branded login</h1>')
    expect(html).toContain('<span>custom-csrf</span>')
  })
})
