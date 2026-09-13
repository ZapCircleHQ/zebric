import { describe, expect, it } from 'vitest'
import { matchesQueryPredicate, normalizeQueryWhere } from './query-normalization.js'

describe('normalizeQueryWhere', () => {
  const context = {
    params: { id: 'route-1' },
    query: { state: 'open' },
    session: { user: { id: 'user-1', role: 'admin' } },
  } as any

  it('normalizes legacy and explicit placeholders identically', () => {
    expect(normalizeQueryWhere({ id: '{id}' }, context)).toEqual(
      normalizeQueryWhere({ id: '$params.id' }, context),
    )
    expect(normalizeQueryWhere({ state: '$query.state' }, context)).toMatchObject({ value: 'open' })
    expect(normalizeQueryWhere({ ownerId: '$currentUser.id' }, context)).toMatchObject({ value: 'user-1' })
  })

  it('supports prefixed and unprefixed comparison operators', () => {
    expect(normalizeQueryWhere({ priority: { $gte: 2, lt: 5 } }, context)).toEqual({
      kind: 'group',
      operator: 'and',
      predicates: [
        { kind: 'comparison', field: 'priority', operator: 'gte', value: 2 },
        { kind: 'comparison', field: 'priority', operator: 'lt', value: 5 },
      ],
    })
  })

  it('turns an unresolved placeholder into a deny predicate', () => {
    expect(normalizeQueryWhere({ id: '$params.missing' }, context)).toEqual({
      kind: 'constant',
      value: false,
    })
  })

  it('preserves nested boolean groups and sibling comparisons', () => {
    const predicate = normalizeQueryWhere({
      or: [{ status: 'open' }, { priority: { $gt: 3 } }],
      archived: false,
    })

    expect(matchesQueryPredicate({ status: 'closed', priority: 4, archived: false }, predicate)).toBe(true)
    expect(matchesQueryPredicate({ status: 'open', priority: 1, archived: true }, predicate)).toBe(false)
  })

  it('evaluates the canonical operator set', () => {
    const row = { score: 4, state: 'open', deletedAt: null, title: 'Hello world' }
    expect(matchesQueryPredicate(row, normalizeQueryWhere({ score: { $in: [3, 4], $lte: 4 } }))).toBe(true)
    expect(matchesQueryPredicate(row, normalizeQueryWhere({ state: { $ne: 'closed' } }))).toBe(true)
    expect(matchesQueryPredicate(row, normalizeQueryWhere({ deletedAt: { $null: true } }))).toBe(true)
    expect(matchesQueryPredicate(row, normalizeQueryWhere({ title: { $like: 'Hello%' } }))).toBe(true)
  })

  it('rejects unknown operators instead of silently widening a query', () => {
    expect(() => normalizeQueryWhere({ score: { $between: [1, 5] } }))
      .toThrow('Unsupported query operator: $between')
  })

  it('fails closed for fields outside the entity contract', () => {
    expect(normalizeQueryWhere(
      { misspelled: 'value' },
      {},
      { allowedFields: new Set(['id', 'title']) },
    )).toEqual({ kind: 'constant', value: false })
  })
})
