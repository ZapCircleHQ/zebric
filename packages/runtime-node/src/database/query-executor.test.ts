import { describe, expect, it } from 'vitest'
import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core'
import { QueryExecutor } from './query-executor.js'

const userTable = pgTable('user', {
  id: text('id'),
  name: text('name'),
  email: text('email'),
})

function blueprint() {
  return {
    version: '1.0',
    project: { name: 'x', version: '0.1.0', runtime: { min_version: '0.1.0' } },
    entities: [],
    pages: [],
  } as any
}

describe('QueryExecutor.search', () => {
  it('uses ILIKE for postgres lookup search predicates', async () => {
    let capturedWhere: any

    const db = {
      select() {
        return {
          from() {
            return {
              where(where: any) {
                capturedWhere = where
                return {
                  limit: async () => [],
                }
              },
            }
          },
        }
      },
    }

    const connection = {
      getDb: () => db,
      getTable: () => userTable,
      getEntity: () => undefined,
      getType: () => 'postgres' as const,
    }

    const executor = new QueryExecutor(connection as any, undefined)
    await executor.search('User', ['name', 'email'], 'alice', {})

    const compiled = new PgDialect().sqlToQuery(capturedWhere)
    expect(compiled.sql).toContain('ilike')
    expect(compiled.sql).not.toContain(' like ')
  })
})

describe('QueryExecutor.findById', () => {
  it('returns null when the requested record fails read access checks', async () => {
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit: async () => [{ id: 'user-1', name: 'Alice', user_id: 'owner-1' }],
                }
              },
            }
          },
        }
      },
    }

    const entity = {
      name: 'User',
      fields: [
        { name: 'id', type: 'Text' },
        { name: 'name', type: 'Text' },
        { name: 'userId', type: 'Text' },
      ],
      access: {
        read: { userId: '$currentUser.id' },
      },
    }

    const connection = {
      getDb: () => db,
      getTable: () => userTable,
      getEntity: () => entity,
      getType: () => 'postgres' as const,
    }

    const executor = new QueryExecutor(connection as any, undefined)

    const hidden = await executor.findById('User', 'user-1', {
      session: {
        id: 'sess-2',
        userId: 'owner-2',
        user: { id: 'owner-2' },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    expect(hidden).toBeNull()

    const visible = await executor.findById('User', 'user-1', {
      session: {
        id: 'sess-1',
        userId: 'owner-1',
        user: { id: 'owner-1' },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    expect(visible).toEqual({ id: 'user-1', name: 'Alice', userId: 'owner-1' })
  })
})
