import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Blueprint } from '@zebric/runtime-core'
import { DatabaseConnection } from './connection.js'
import { QueryExecutor } from './query-executor.js'

const authenticatedSession = {
  user: { id: 'roadmap-agent', name: 'Roadmap Agent', email: '' },
} as any

const blueprint: Blueprint = {
  version: '0.1.0',
  hash: 'access-test',
  project: {
    name: 'Access test',
    version: '0.1.0',
    runtime: { min_version: '0.1.0' },
  },
  entities: [{
    name: 'RoadmapItem',
    fields: [
      { name: 'id', type: 'ULID', primary_key: true },
      { name: 'title', type: 'Text', required: true },
      { name: 'visibility', type: 'Enum', values: ['public', 'internal'], required: true },
      { name: 'publishedAt', type: 'DateTime' },
      { name: 'createdAt', type: 'DateTime', default: 'now' },
    ],
    access: {
      read: { or: [{ visibility: 'public' }, 'authenticated'] },
      create: 'authenticated',
      update: 'authenticated',
      delete: 'authenticated',
    },
  }],
  pages: [],
}

describe('QueryExecutor row access', () => {
  let connection: DatabaseConnection
  let executor: QueryExecutor

  beforeEach(async () => {
    connection = new DatabaseConnection({ type: 'sqlite', filename: ':memory:' }, blueprint)
    await connection.connect()
    executor = new QueryExecutor(connection)
    await executor.create('RoadmapItem', {
      id: 'public-item', title: 'Public item', visibility: 'public',
    }, { session: authenticatedSession })
    await executor.create('RoadmapItem', {
      id: 'internal-item', title: 'Internal item', visibility: 'internal',
    }, { session: authenticatedSession })
  })

  afterEach(async () => {
    await connection.close()
  })

  it('returns only public rows anonymously and all rows when authenticated', async () => {
    const anonymous = await executor.execute({ entity: 'RoadmapItem', orderBy: { title: 'asc' } })
    const authenticated = await executor.execute(
      { entity: 'RoadmapItem', orderBy: { title: 'asc' } },
      { session: authenticatedSession },
    )

    expect(anonymous.map(item => item.id)).toEqual(['public-item'])
    expect(authenticated.map(item => item.id)).toEqual(['internal-item', 'public-item'])
  })

  it('does not return an internal row by id anonymously', async () => {
    expect(await executor.findById('RoadmapItem', 'internal-item')).toBeNull()
    expect(await executor.findById('RoadmapItem', 'internal-item', { session: authenticatedSession }))
      .toMatchObject({ id: 'internal-item' })
  })

  it('rejects anonymous mutations', async () => {
    await expect(executor.create('RoadmapItem', {
      title: 'Unauthorized', visibility: 'public',
    })).rejects.toThrow('Access denied')
    await expect(executor.update('RoadmapItem', 'public-item', {
      title: 'Unauthorized update',
    })).rejects.toThrow('Access denied')
    await expect(executor.delete('RoadmapItem', 'public-item')).rejects.toThrow('Access denied')
  })

  it('normalizes DateTime strings and blank optional values for database writes', async () => {
    const created = await executor.create('RoadmapItem', {
      id: 'scheduled-item',
      title: 'Scheduled item',
      visibility: 'internal',
      publishedAt: '2026-06-22T14:30',
    }, { session: authenticatedSession })

    expect(created.publishedAt).toBeInstanceOf(Date)
    expect(created.publishedAt.getTime()).not.toBeNaN()

    const updated = await executor.update('RoadmapItem', 'scheduled-item', {
      publishedAt: '',
    }, { session: authenticatedSession })
    expect(updated.publishedAt).toBeNull()
  })

  it('rejects invalid DateTime values with a field-specific error', async () => {
    await expect(executor.create('RoadmapItem', {
      title: 'Invalid schedule',
      visibility: 'internal',
      publishedAt: 'not-a-date',
    }, { session: authenticatedSession }))
      .rejects.toThrow('Invalid DateTime value for RoadmapItem.publishedAt')
  })
})
