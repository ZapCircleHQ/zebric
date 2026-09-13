import { describe, expect, it } from 'vitest'
import { createBehaviorHelpers } from './behaviors.js'

describe('createBehaviorHelpers', () => {
  const fixedDate = new Date('2026-09-12T14:30:00.000Z')
  const helpers = createBehaviorHelpers(() => fixedDate)

  it('provides deterministic ISO date helpers', () => {
    expect(helpers.today()).toBe('2026-09-12')
    expect(helpers.now()).toBe('2026-09-12T14:30:00.000Z')
  })

  it('uses the core HTML escaping policy', () => {
    expect(helpers.escapeHtml(`<script src='/x'>`)).toBe('&lt;script src=&#x27;&#x2F;x&#x27;&gt;')
  })

  it('formats dates for behavior display', () => {
    expect(helpers.formatDate('2026-09-12T14:30:00.000Z')).toContain('Sep')
    expect(helpers.formatDateTime('2026-09-12T14:30:00.000Z')).toContain('2026')
  })
})
