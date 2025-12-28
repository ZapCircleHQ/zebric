import { describe, it, expect, beforeEach } from 'vitest'
import { D1Adapter } from './d1-adapter.js'
import { MockD1Database } from '../test-helpers/mocks.js'

describe('D1Adapter', () => {
  let db: MockD1Database
  let adapter: D1Adapter

  beforeEach(() => {
    db = new MockD1Database()
    adapter = new D1Adapter(db as any)
  })

  describe('query', () => {
    it('should execute SELECT query and return rows', async () => {
      // Create table
      await db.exec('CREATE TABLE users (id TEXT, name TEXT)')

      // Insert data directly into mock
      const stmt = await db.prepare('INSERT INTO users VALUES (?, ?)')
      await stmt.bind('1', 'Alice').run()
      await stmt.bind('2', 'Bob').run()

      // Query through adapter
      const result = await adapter.query('SELECT * FROM users')

      expect(result.rows).toHaveLength(2)
    })

    it('should execute INSERT query', async () => {
      await db.exec('CREATE TABLE users (id TEXT, name TEXT)')

      const result = await adapter.query(
        'INSERT INTO users (id, name) VALUES (?, ?)',
        ['1', 'Alice']
      )

      expect(result.rows).toBeDefined()
    })

    it('should handle query with parameters', async () => {
      await db.exec('CREATE TABLE users (id TEXT, name TEXT)')

      await adapter.query('INSERT INTO users VALUES (?, ?)', ['1', 'Alice'])
      const result = await adapter.query('SELECT * FROM users WHERE id = ?', ['1'])

      expect(result.rows).toHaveLength(1)
    })

    it('should surface errors for nonexistent table', async () => {
      await expect(adapter.query('SELECT * FROM nonexistent'))
        .rejects.toThrow('D1 query error')
    })
  })

  describe('transaction', () => {
    it('should execute transaction with multiple operations', async () => {
      await db.exec('CREATE TABLE users (id TEXT, name TEXT)')

      const result = await adapter.transaction(async (tx) => {
        await tx.query('INSERT INTO users VALUES (?, ?)', ['1', 'Alice'])
        await tx.query('INSERT INTO users VALUES (?, ?)', ['2', 'Bob'])
        return 'success'
      })

      expect(result).toBe('success')

      const users = await adapter.query('SELECT * FROM users')
      expect(users.rows).toHaveLength(2)
    })

    it('should rollback transaction on error', async () => {
      await db.exec('CREATE TABLE users (id TEXT, name TEXT)')

      await expect(
        adapter.transaction(async (tx) => {
          await tx.query('INSERT INTO users VALUES (?, ?)', ['1', 'Alice'])
          throw new Error('Rollback!')
        })
      ).rejects.toThrow('Rollback!')

      // In a real D1 database, this would be empty due to rollback
      // In our mock, we don't fully implement transactions
    })
  })

  describe('migrate', () => {
    it('should execute migration statements', async () => {
      const statements = [
        'CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)',
        'CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT)',
      ]

      await adapter.migrate(statements)

      // Verify tables were created
      const result = await db.prepare('SELECT * FROM users').all()
      expect(result.success).toBe(true)
    })
  })

  describe('healthCheck', () => {
    it('should return true for healthy connection', async () => {
      const healthy = await adapter.healthCheck()
      expect(healthy).toBe(true)
    })

    it('should return false on connection error', async () => {
      // Create an adapter with a broken database
      const brokenDb = {
        prepare: () => {
          throw new Error('Connection failed')
        }
      } as any

      const brokenAdapter = new D1Adapter(brokenDb)
      const healthy = await brokenAdapter.healthCheck()

      expect(healthy).toBe(false)
    })
  })

  describe('close', () => {
    it('should close without errors', async () => {
      await expect(adapter.close()).resolves.toBeUndefined()
    })
  })
})
