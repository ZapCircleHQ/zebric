import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'
import { SYSTEM_SESSION, type Blueprint } from '@zebric/runtime-core'
import { D1Adapter } from '../../src/database/d1-adapter.js'
import { WorkersQueryExecutor } from '../../src/query/workers-query-executor.js'

const entity = {
  name: 'RoadmapUpdate',
  fields: [
    { name: 'id', type: 'ULID', primary_key: true },
    { name: 'title', type: 'Text' },
    { name: 'published', type: 'Boolean', default: false },
    { name: 'active', type: 'Boolean', default: true },
    { name: 'position', type: 'Integer', default: 0 },
    { name: 'status', type: 'Text', default: 'draft' },
    { name: 'createdAt', type: 'DateTime', default: 'now' },
    { name: 'updatedAt', type: 'DateTime' },
    { name: 'userId', type: 'Text' },
    { name: 'authorId', type: 'Ref', ref: 'User.id' }
  ],
  access: { read: { published: true }, create: 'public', update: { active: true } }
} as const
const blueprint = { entities: [entity] } as unknown as Blueprint
const system = { session: SYSTEM_SESSION }
const anonymous = { session: null }

describe('D1 entity values and boolean access rules', () => {
  let mf: Miniflare
  let adapter: D1Adapter
  let queries: WorkersQueryExecutor

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-04-28',
      d1Databases: { DB: 'entity-values' }
    })
    adapter = new D1Adapter(await mf.getD1Database('DB'))
    // No SQL defaults or coercion triggers: the Blueprint drives create values.
    await adapter.query(`CREATE TABLE RoadmapUpdate (
      id TEXT PRIMARY KEY NOT NULL, title TEXT, published INTEGER, active INTEGER,
      position INTEGER, status TEXT, createdAt TEXT, updatedAt TEXT, userId TEXT, authorId TEXT
    )`)
    queries = new WorkersQueryExecutor(adapter, blueprint)
  })
  afterAll(async () => { await mf?.dispose() })

  it('generates unique ULIDs and applies false, true, zero, enum and timestamp defaults without mutating input', async () => {
    const input = { title: 'Draft defaults' }
    const first = await queries.create(entity.name, input, system)
    const second = await queries.create(entity.name, input, system)
    expect(first.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(first.id).not.toBe(second.id)
    expect(first).toMatchObject({ published: false, active: true, position: 0, status: 'draft' })
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false)
    expect(first.updatedAt).toBe(first.createdAt)
    expect(input).toEqual({ title: 'Draft defaults' })
    const stored = (await adapter.query('SELECT * FROM RoadmapUpdate WHERE id = ?', [first.id])).rows[0]
    expect(stored).toMatchObject({ published: 0, active: 1 })
    expect(await queries.findById(entity.name, first.id, anonymous)).toBeNull()
  })

  it('preserves supplied IDs, false, zero and null instead of replacing them with defaults', async () => {
    const record = await queries.create(entity.name, {
      id: 'explicit-values', published: true, active: false, position: 0, status: null
    }, system)
    expect(record).toMatchObject({ id: 'explicit-values', published: true, active: false, position: 0, status: null })
  })

  it('populates userId and User reference fields from the session', async () => {
    const record = await queries.create(entity.name, { title: 'Owned' }, {
      session: { user: { id: 'author' } } as any
    })
    expect(record).toMatchObject({ userId: 'author', authorId: 'author' })
  })

  it.each([
    ['true', true], ['false', false], ['on', true], ['off', false],
    ['1', true], ['0', false], ['', false], [true, true], [false, false], [1, true], [0, false]
  ])('coerces form/API Boolean %j on create and update to SQLite integers', async (value, expected) => {
    const record = await queries.create(entity.name, { title: 'Boolean values', published: value }, system)
    expect(record.published).toBe(expected)
    const stored = await adapter.query('SELECT published, typeof(published) AS type FROM RoadmapUpdate WHERE id = ?', [record.id])
    expect(stored.rows[0]).toEqual({ published: expected ? 1 : 0, type: 'integer' })
    const updated = await queries.update(entity.name, record.id, { published: expected ? 'false' : 'true' }, anonymous)
    expect(updated.published).toBe(!expected)
  })

  it('rejects unrecognized Boolean values rather than making them truthy', async () => {
    await expect(queries.create(entity.name, { published: 'draft' }, system)).rejects.toThrow('Invalid Boolean')
    const record = await queries.create(entity.name, {}, system)
    await expect(queries.update(entity.name, record.id, { published: 2 }, system)).rejects.toThrow('Invalid Boolean')
  })

  it('exposes published rows and hides drafts in anonymous lists, ID lookups and search', async () => {
    const published = await queries.create(entity.name, { title: 'Visibility published', published: 'true' }, system)
    const draft = await queries.create(entity.name, { title: 'Visibility draft' }, system)
    expect(await queries.execute({ entity: entity.name, where: { id: published.id } }, anonymous)).toEqual([published])
    expect(await queries.findById(entity.name, draft.id, anonymous)).toBeNull()
    expect(await queries.search(entity.name, ['title'], 'Visibility', { context: anonymous })).toEqual([published])
    const expressionQueries = new WorkersQueryExecutor(adapter, {
      entities: [{ ...entity, access: { read: 'record.published == true' } }]
    } as unknown as Blueprint)
    expect(await expressionQueries.findById(entity.name, published.id, anonymous)).toEqual(published)
    expect(await expressionQueries.findById(entity.name, draft.id, anonymous)).toBeNull()
  })

  it('normalizes values before checking Boolean create rules', async () => {
    const restricted = new WorkersQueryExecutor(adapter, {
      entities: [{ ...entity, access: { create: { published: true } } }]
    } as unknown as Blueprint)
    expect((await restricted.create(entity.name, { published: 'true' }, anonymous)).published).toBe(true)
    await expect(restricted.create(entity.name, { published: 'false' }, anonymous)).rejects.toThrow('Access denied')
  })

  it('normalizes Boolean values for shared field-level access checks', async () => {
    const published = await queries.create(entity.name, { title: 'Public title', published: true }, system)
    const draft = await queries.create(entity.name, { title: 'Private title' }, system)
    const fieldQueries = new WorkersQueryExecutor(adapter, {
      entities: [{
        ...entity,
        access: { read: 'public' },
        fields: entity.fields.map(field => field.name === 'title'
          ? { ...field, access: { read: { published: true } } }
          : field)
      }]
    } as unknown as Blueprint)
    expect((await fieldQueries.findById(entity.name, published.id, anonymous)).title).toBe('Public title')
    expect(await fieldQueries.findById(entity.name, draft.id, anonymous)).not.toHaveProperty('title')
  })

  it('does not treat null or unexpected stored integers as true in read policies', async () => {
    const expressionQueries = new WorkersQueryExecutor(adapter, {
      entities: [{ ...entity, access: { read: 'record.published == true' } }]
    } as unknown as Blueprint)
    for (const value of [null, 2, -1]) {
      const record = await queries.create(entity.name, { title: 'Invalid stored Boolean' }, system)
      await adapter.query('UPDATE RoadmapUpdate SET published = ? WHERE id = ?', [value, record.id])
      expect(await queries.findById(entity.name, record.id, anonymous)).toBeNull()
      expect(await expressionQueries.findById(entity.name, record.id, anonymous)).toBeNull()
    }
  })

  it('uses the same create defaults and Boolean coercion for prepared batch mutations', async () => {
    const statements = await queries.prepareBatchMutation(entity.name, 'create', { title: 'Batch', published: 'true' }, undefined, system)
    await queries.executeBatch(statements)
    const records = await queries.search(entity.name, ['title'], 'Batch', { context: anonymous })
    expect(records[0]).toMatchObject({ published: true, active: true, position: 0, status: 'draft' })
    expect(records[0].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('replays a transaction receipt with the same generated ID and defaults', async () => {
    let attempts = 0
    const operation = () => { attempts++; return queries.create(entity.name, { title: 'Receipt', published: 'true' }, system) }
    const receipt = { key: 'create-defaults', fingerprint: 'create' }
    const first = await queries.transaction(operation, receipt)
    const replay = await queries.transaction(operation, receipt)
    expect(replay).toEqual(first)
    expect(attempts).toBe(1)
    expect(await queries.findById(entity.name, first.id, anonymous)).toEqual(first)
  })
})
