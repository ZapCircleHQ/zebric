import { describe, expect, it } from 'vitest'
import { defaultTheme } from './theme.js'
import {
  getActionButtonClass,
  getActionSemanticRole,
  getStatusRoleClass,
  getStatusSemanticRole,
} from './semantic-role-resolver.js'
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

describe('semantic role resolver', () => {
  it('maps action variants to semantic roles', () => {
    expect(getActionSemanticRole(undefined)).toBe('primary-action')
    expect(getActionSemanticRole('secondary')).toBe('secondary-action')
    expect(getActionSemanticRole('ghost')).toBe('secondary-action')
    expect(getActionSemanticRole('danger')).toBe('destructive-action')
  })

  it('uses design adapter role mappings when present', () => {
    const blueprint = makeBlueprint({
      design_adapter: {
        roles: {
          'primary-action': 'buttonSecondary',
        },
      },
    })

    expect(getActionButtonClass(undefined, defaultTheme, blueprint)).toBe(defaultTheme.buttonSecondary)
  })

  it('falls back to built-in action classes', () => {
    expect(getActionButtonClass(undefined, defaultTheme)).toBe(defaultTheme.buttonPrimary)
    expect(getActionButtonClass('secondary', defaultTheme)).toBe(defaultTheme.buttonSecondary)
    expect(getActionButtonClass('danger', defaultTheme)).toContain('text-red-600')
  })

  it('maps status values to semantic roles and classes', () => {
    expect(getStatusSemanticRole('done')).toBe('status-positive')
    expect(getStatusSemanticRole('in_progress')).toBe('status-warning')
    expect(getStatusSemanticRole('rejected')).toBe('status-negative')
    expect(getStatusSemanticRole('unknown')).toBe('status-neutral')
    expect(getStatusRoleClass('status-positive')).toContain('green')
    expect(getStatusRoleClass('status-negative')).toContain('red')
  })
})
