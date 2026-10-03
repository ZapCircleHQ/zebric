import { describe, expect, it, vi } from 'vitest'
import { SYSTEM_SESSION } from '@zebric/runtime-core'
import type { Blueprint } from '@zebric/runtime-core'
import type { QueryExecutor } from '../database/query-executor.js'
import { seedDatabase } from './seed.js'

function setup(entities: Array<{ name: string; seed?: Array<Record<string, unknown>> }>, counts: Record<string, number> = {}) {
  const blueprint = {
    entities: entities.map((e) => ({ fields: [], ...e })),
  } as unknown as Blueprint
  const queryExecutor = {
    count: vi.fn(async (query: { entity: string }) => counts[query.entity] ?? 0),
    create: vi.fn(async (_entity: string, data: Record<string, unknown>) => data),
  }
  const logger = { info: vi.fn() }
  return { blueprint, queryExecutor, logger, run: () => seedDatabase(blueprint, queryExecutor as unknown as QueryExecutor, logger) }
}

describe('seedDatabase', () => {
  it('creates every seed record for an empty entity as the system session', async () => {
    const { queryExecutor, run } = setup([{ name: 'Post', seed: [{ title: 'A' }, { title: 'B' }] }])
    await run()

    expect(queryExecutor.create).toHaveBeenCalledTimes(2)
    expect(queryExecutor.create).toHaveBeenNthCalledWith(1, 'Post', { title: 'A' }, { session: SYSTEM_SESSION })
    expect(queryExecutor.create).toHaveBeenNthCalledWith(2, 'Post', { title: 'B' }, { session: SYSTEM_SESSION })
  })

  it('skips entities that already contain data', async () => {
    const { queryExecutor, logger, run } = setup([{ name: 'Post', seed: [{ title: 'A' }] }], { Post: 2 })
    await run()

    expect(queryExecutor.create).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('Skipping seed, entity already has data', { entity: 'Post', existing: 2 })
  })

  it('ignores entities without seed records', async () => {
    const { queryExecutor, run } = setup([{ name: 'Tag' }, { name: 'Note', seed: [] }])
    await run()

    expect(queryExecutor.count).not.toHaveBeenCalled()
    expect(queryExecutor.create).not.toHaveBeenCalled()
  })

  it('seeds each entity independently', async () => {
    const { queryExecutor, run } = setup(
      [{ name: 'Post', seed: [{ title: 'A' }] }, { name: 'Tag', seed: [{ name: 'x' }] }],
      { Post: 1 }
    )
    await run()

    expect(queryExecutor.create).toHaveBeenCalledTimes(1)
    expect(queryExecutor.create).toHaveBeenCalledWith('Tag', { name: 'x' }, { session: SYSTEM_SESSION })
  })

  it('does not mutate the blueprint seed records', async () => {
    const record = { title: 'A' }
    const { queryExecutor, run } = setup([{ name: 'Post', seed: [record] }])
    queryExecutor.create.mockImplementation(async (_e: string, data: Record<string, unknown>) => {
      data.id = 'generated'
      return data
    })
    await run()

    expect(record).toEqual({ title: 'A' })
  })
})
