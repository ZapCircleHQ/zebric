import { describe, expect, it } from 'vitest'
import { getFlashVariantClasses, renderFlash, resolveFeedbackMode } from './feedback-renderer.js'
import type { Blueprint } from '../types/blueprint.js'

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    version: '1.0',
    project: { name: 'Test', version: '1.0.0', runtime: { min_version: '0.1.0' } },
    entities: [],
    pages: [],
    ...overrides,
  } as any
}

describe('feedback renderer', () => {
  it('resolves configured success and error feedback modes', () => {
    const blueprint = makeBlueprint({
      ux: {
        system: {
          feedback: {
            success: 'toast',
            error: 'banner',
          },
        },
      },
    })

    expect(resolveFeedbackMode(blueprint, 'success')).toBe('toast')
    expect(resolveFeedbackMode(blueprint, 'error')).toBe('banner')
    expect(resolveFeedbackMode(blueprint, 'info')).toBe('inline')
  })

  it('renders flash messages with feedback metadata', () => {
    const html = renderFlash(makeBlueprint({
      ux: { system: { feedback: { success: 'toast' } } },
    }), { type: 'success', text: 'Saved.' }).toString()

    expect(html).toContain('data-zebric-feedback="toast"')
    expect(html).toContain('Saved.')
  })

  it('maps flash variants to classes', () => {
    expect(getFlashVariantClasses('success')).toContain('green')
    expect(getFlashVariantClasses('error')).toContain('red')
    expect(getFlashVariantClasses('warning')).toContain('yellow')
    expect(getFlashVariantClasses('info')).toContain('blue')
  })
})
