import { describe, expect, it } from 'vitest'
import { SchemaDiffer } from './schema-diff.js'

function bp(entities: any[]) {
  return {
    version: '1.0',
    project: { name: 'x', version: '0.1.0', runtime: { min_version: '0.1.0' } },
    entities,
    pages: [],
  } as any
}

function entity(name: string, fields: any[]) {
  return { name, fields }
}

describe('SchemaDiffer', () => {
  it('marks all entities as added when previous is undefined', () => {
    const next = bp([entity('User', [{ name: 'id', type: 'ULID', primary_key: true }])])
    const diff = SchemaDiffer.diff(undefined, next)

    expect(diff.entitiesAdded).toHaveLength(1)
    expect(diff.hasChanges).toBe(true)
    expect(diff.hasBreakingChanges).toBe(false)
  })

  it('detects added and removed entities', () => {
    const previous = bp([entity('User', [{ name: 'id', type: 'ULID' }])])
    const next = bp([entity('Post', [{ name: 'id', type: 'ULID' }])])
    const diff = SchemaDiffer.diff(previous, next)

    expect(diff.entitiesAdded.map(e => e.name)).toEqual(['Post'])
    expect(diff.entitiesRemoved.map(e => e.name)).toEqual(['User'])
    expect(diff.hasBreakingChanges).toBe(true)
  })

  it('detects added/removed fields in common entities', () => {
    const previous = bp([
      entity('User', [
        { name: 'id', type: 'ULID' },
        { name: 'email', type: 'Email' },
      ]),
    ])
    const next = bp([
      entity('User', [
        { name: 'id', type: 'ULID' },
        { name: 'name', type: 'Text' },
      ]),
    ])
    const diff = SchemaDiffer.diff(previous, next)

    expect(diff.fieldsAdded).toHaveLength(1)
    expect(diff.fieldsAdded[0]?.field.name).toBe('name')
    expect(diff.fieldsRemoved).toHaveLength(1)
    expect(diff.fieldsRemoved[0]?.field.name).toBe('email')
    expect(diff.hasBreakingChanges).toBe(true)
  })

  it('detects non-breaking field changes', () => {
    const previous = bp([
      entity('User', [{ name: 'nickname', type: 'Text', required: true, nullable: false }]),
    ])
    const next = bp([
      entity('User', [{ name: 'nickname', type: 'Text', required: false, nullable: true }]),
    ])
    const diff = SchemaDiffer.diff(previous, next)

    expect(diff.fieldsChanged).toHaveLength(1)
    expect(diff.hasChanges).toBe(true)
    expect(diff.hasBreakingChanges).toBe(false)
  })

  it('detects breaking field changes', () => {
    const previous = bp([
      entity('User', [{ name: 'age', type: 'Integer', required: false, nullable: true, default: 1 }]),
    ])
    const next = bp([
      entity('User', [{ name: 'age', type: 'Float', required: true, nullable: false, default: 2 }]),
    ])
    const diff = SchemaDiffer.diff(previous, next)

    expect(diff.fieldsChanged).toHaveLength(1)
    expect(diff.hasBreakingChanges).toBe(true)
  })

  it('considers enum value order and content for field equality', () => {
    const previous = bp([
      entity('User', [{ name: 'role', type: 'Enum', values: ['user', 'admin'] }]),
    ])
    const next = bp([
      entity('User', [{ name: 'role', type: 'Enum', values: ['admin', 'user'] }]),
    ])

    const diff = SchemaDiffer.diff(previous, next)
    expect(diff.fieldsChanged).toHaveLength(1)
  })

  it('returns no changes for identical schema', () => {
    const previous = bp([
      entity('User', [{ name: 'id', type: 'ULID', required: true, nullable: false }]),
    ])
    const next = bp([
      entity('User', [{ name: 'id', type: 'ULID', required: true, nullable: false }]),
    ])

    const diff = SchemaDiffer.diff(previous, next)
    expect(diff.hasChanges).toBe(false)
    expect(diff.hasBreakingChanges).toBe(false)
    expect(diff.fieldsChanged).toHaveLength(0)
  })
})
