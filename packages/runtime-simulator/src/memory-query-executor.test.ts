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

describe('BrowserMemoryQueryExecutor canonical predicates', () => {
  it('evaluates nested groups and comparison operators', async () => {
    const executor = makeExecutor([
      { id: 'bella', name: 'Bella' },
      { id: 'max', name: 'Max' },
    ])

    const rows = await executor.execute({
      entity: 'Dog',
      where: {
        or: [{ id: { $in: ['bella'] } }, { name: { $like: 'Ma%' } }],
        id: { $ne: 'max' },
      },
    } as any, { session: null } as any)

    expect(rows.map(row => row.id)).toEqual(['bella'])
  })
})

describe('BrowserMemoryQueryExecutor access conformance', () => {
  const member = { user: { id: 'user-1', role: 'member' } } as any
  const other = { user: { id: 'user-2', role: 'member' } } as any
  const documentEntity: Entity = {
    name: 'Document',
    fields: [
      { name: 'id', type: 'ULID', primary_key: true },
      { name: 'title', type: 'Text' },
      { name: 'userId', type: 'Text' },
      { name: 'secret', type: 'Text', access: { read: false, write: false } },
    ],
    access: {
      read: 'owner',
      create: 'authenticated',
      update: 'owner',
      delete: 'owner',
    },
  }

  function accessExecutor() {
    const blueprint = {
      entities: [documentEntity],
      auth: {
        providers: ['email'],
        permissions: { member: { allow: ['Document.*'] } },
      },
    } as unknown as Blueprint
    return new BrowserMemoryQueryExecutor(blueprint, {
      Document: [
        { id: 'mine', title: 'Mine', userId: 'user-1', secret: 'hidden' },
        { id: 'theirs', title: 'Theirs', userId: 'user-2', secret: 'hidden' },
      ],
    }, new SimulatorLogger())
  }

  it('applies row and field access to findById', async () => {
    const executor = accessExecutor()

    await expect(executor.findById('Document', 'theirs', { session: member })).resolves.toBeNull()
    await expect(executor.findById('Document', 'mine', { session: member })).resolves.toEqual({
      id: 'mine',
      title: 'Mine',
      userId: 'user-1',
    })
  })

  it('authorizes updates against the stored owner and filters returned fields', async () => {
    const executor = accessExecutor()

    await expect(executor.update('Document', 'theirs', {
      userId: 'user-1',
      title: 'Taken over',
    }, { session: member })).rejects.toThrow('Access denied: Cannot update Document')

    const updated = await executor.update('Document', 'mine', {
      title: 'Updated',
      secret: 'replacement',
    }, { session: member })
    expect(updated).toEqual({ id: 'mine', title: 'Updated', userId: 'user-1' })
  })

  it('enforces blueprint RBAC', async () => {
    const executor = accessExecutor()

    await expect(executor.findById('Document', 'theirs', { session: other })).resolves.toEqual({
      id: 'theirs',
      title: 'Theirs',
      userId: 'user-2',
    })
    await expect(executor.execute({ entity: 'Document' }, { session: null }))
      .rejects.toThrow('Access denied: Cannot read Document')
  })
})
