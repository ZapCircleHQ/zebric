import { describe, expect, it } from 'vitest'
import type { Blueprint, Entity } from '@zebric/runtime-core'
import { BrowserMemoryQueryExecutor } from './memory-query-executor.js'
import { SimulatorLogger } from './logger.js'

const dogEntity: Entity = {
  name: 'Dog',
  fields: [
    { name: 'id', type: 'ULID', primary_key: true },
    { name: 'name', type: 'Text' },
  ],
}

function makeExecutor(rows: Array<Record<string, any>> = [{ id: 'bella', name: 'Bella' }]) {
  const blueprint = { entities: [dogEntity] } as unknown as Blueprint
  return new BrowserMemoryQueryExecutor(blueprint, { Dog: rows }, new SimulatorLogger())
}

// The production runtime (packages/runtime-node/src/database/query-executor.ts) resolves
// route/query/session placeholders using `$params.x`, `$query.x`, and `$currentUser.x`.
// Blueprints are written against that convention - including ones (like Friendly Paws,
// examples/dog-rescue/blueprint.toml) that are also loaded into this in-browser simulator
// for the Playground. The simulator's resolver only understood the older `{x}` brace form,
// so every `where = { id = "$params.id" }` detail-page query silently matched zero rows
// instead of throwing - the id field of a "Dog" record is never the literal string
// "$params.id" - so the page rendered with no data instead of erroring. These tests pin
// the resolver's placeholder support to what production supports, one form at a time.
describe('BrowserMemoryQueryExecutor placeholder resolution', () => {
  it('resolves $params.x from route params (the Friendly Paws detail-page bug)', async () => {
    const executor = makeExecutor()

    const rows = await executor.execute(
      { entity: 'Dog', where: { id: '$params.id' } } as any,
      { params: { id: 'bella' }, session: null } as any
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Bella')
  })

  it('does not match rows when the referenced route param is absent', async () => {
    const executor = makeExecutor()

    const rows = await executor.execute(
      { entity: 'Dog', where: { id: '$params.id' } } as any,
      { params: {}, session: null } as any
    )

    expect(rows).toHaveLength(0)
  })

  it('resolves $query.x from the query string', async () => {
    const executor = makeExecutor()

    const rows = await executor.execute(
      { entity: 'Dog', where: { id: '$query.dogId' } } as any,
      { query: { dogId: 'bella' }, session: null } as any
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Bella')
  })

  it('resolves the $currentUser.id shorthand from the session', async () => {
    const executor = makeExecutor([{ id: 'user-1', name: 'Owner' }])

    const rows = await executor.execute(
      { entity: 'Dog', where: { id: '$currentUser.id' } } as any,
      { session: { user: { id: 'user-1' } } } as any
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Owner')
  })

  it('resolves arbitrary $currentUser.<field> references from the session', async () => {
    const executor = makeExecutor([{ id: 'bella', name: 'coordinator@example.test' }])

    const rows = await executor.execute(
      { entity: 'Dog', where: { name: '$currentUser.email' } } as any,
      { session: { user: { id: 'user-1', email: 'coordinator@example.test' } } } as any
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('bella')
  })

  it('still resolves the legacy {x} brace syntax used by other Playground blueprints', async () => {
    const executor = makeExecutor()

    const rows = await executor.execute(
      { entity: 'Dog', where: { id: '{id}' } } as any,
      { params: { id: 'bella' }, session: null } as any
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Bella')
  })

  it('treats an unrecognized placeholder form as a literal value rather than matching everything', async () => {
    const executor = makeExecutor()

    const rows = await executor.execute(
      { entity: 'Dog', where: { id: '$unsupported.id' } } as any,
      { params: { id: 'bella' }, session: null } as any
    )

    expect(rows).toHaveLength(0)
  })
})
