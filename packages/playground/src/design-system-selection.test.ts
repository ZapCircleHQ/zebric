import { describe, expect, it } from 'vitest'
import type { Blueprint } from '@zebric/runtime-core'
import {
  getPlaygroundDesignSystem,
  playgroundDesignSystems,
  withPlaygroundDesignSystem,
} from './design-system-selection.js'

const blueprint = {
  version: '1.0',
  hash: 'source-hash',
  project: { name: 'Test', version: '1.0.0', runtime: { min_version: '0.1.0' } },
  entities: [],
  pages: [],
} as Blueprint

describe('playground design-system selection', () => {
  it('offers exactly the four built-in systems', () => {
    expect(playgroundDesignSystems.map(system => system.name))
      .toEqual(['modern', 'classic', 'friendly', 'minimal'])
  })

  it('uses a blueprint built-in as the initial selection', () => {
    expect(getPlaygroundDesignSystem({
      ...blueprint,
      design_system: { name: 'friendly' },
    })).toBe('friendly')
  })

  it('falls back to modern for custom systems', () => {
    expect(getPlaygroundDesignSystem({
      ...blueprint,
      design_system: { name: 'custom-company-system' },
    })).toBe('modern')
  })

  it('overrides only the preview copy and changes its hash', () => {
    const preview = withPlaygroundDesignSystem(blueprint, 'classic')

    expect(preview.design_system).toEqual({ name: 'classic' })
    expect(preview.hash).toBe('source-hash:design-system:classic')
    expect(blueprint.design_system).toBeUndefined()
  })
})
