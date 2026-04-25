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
