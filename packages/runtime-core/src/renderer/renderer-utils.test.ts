import { describe, expect, it } from 'vitest'
import { RendererUtils } from './renderer-utils.js'
import type { Blueprint } from '../types/blueprint.js'

const blueprint: Blueprint = {
  version: '1.0',
  project: { name: 'Test', version: '1.0.0', runtime: { min_version: '0.1.0' } },
  entities: [],
  pages: [],
}

describe('RendererUtils value formatting', () => {
  const utils = new RendererUtils(blueprint)

  it('preserves Text values that happen to have a ULID shape', () => {
    expect(utils.formatValue('ABCDEFGHJKMNPQRSTVWXYZ1234', 'Text'))
      .toBe('ABCDEFGHJKMNPQRSTVWXYZ1234')
  })

  it('preserves Text values that happen to have a UUID shape', () => {
    expect(utils.formatValue('123e4567-e89b-12d3-a456-426614174000', 'Text'))
      .toBe('123e4567-e89b-12d3-a456-426614174000')
  })

  it('removes technical JSON keys without redacting unrelated shaped values', () => {
    const value = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      trackingNumber: 'ABCDEFGHJKMNPQRSTVWXYZ1234',
      nested: {
        ownerId: '123e4567-e89b-12d3-a456-426614174000',
        note: 'Called adopter',
      },
    }

    expect(JSON.parse(utils.formatValue(value, 'JSON'))).toEqual({
      trackingNumber: 'ABCDEFGHJKMNPQRSTVWXYZ1234',
      nested: { note: 'Called adopter' },
    })
  })
})
