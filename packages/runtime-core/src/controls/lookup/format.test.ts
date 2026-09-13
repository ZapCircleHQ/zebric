import { describe, expect, it } from 'vitest'
import { formatDisplay } from './format.js'

describe('formatDisplay', () => {
  it('substitutes template fields and removes nullish values', () => {
    expect(formatDisplay(
      { firstName: 'Ada', lastName: 'Lovelace', suffix: null },
      '{lastName}, {firstName} {suffix}',
    )).toBe('Lovelace, Ada')
  })

  it('uses the first populated fallback or conventional display field', () => {
    expect(formatDisplay({ code: '', title: 'Engineer', id: '1' }, undefined, ['code']))
      .toBe('Engineer')
    expect(formatDisplay({ id: 42 })).toBe('42')
  })

  it('returns an empty string when no display value exists', () => {
    expect(formatDisplay({})).toBe('')
  })
})
