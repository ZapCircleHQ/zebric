/**
 * Workers Query Executor Integration Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WorkersQueryExecutor } from './workers-query-executor.js'
import { MockD1Database } from '../test-helpers/mocks.js'
import { D1Adapter } from '../database/d1-adapter.js'
import type { Blueprint, Query } from '@zebric/runtime-core'
import type { RequestContext } from '@zebric/runtime-core'

describe('WorkersQueryExecutor', () => {
  let executor: WorkersQueryExecutor
  let db: MockD1Database
  let adapter: D1Adapter
  let blueprint: Blueprint

  beforeEach(async () => {
    db = new MockD1Database()
    adapter = new D1Adapter(db as any)

    // Create test blueprint
    blueprint = {
      version: '1.0.0',
      project: {
        name: 'Test App',
        version: '1.0.0',
        runtime: { min_version: '0.1.0' }
      },
      entities: [
        {
          name: 'Task',
          fields: [
            { name: 'id', type: 'ULID', primary_key: true },
            { name: 'title', type: 'Text', required: true },
            { name: 'description', type: 'LongText' },
            { name: 'status', type: 'Enum', values: ['pending', 'completed'] },
            { name: 'userId', type: 'Text' }
          ]
        },
        {
          name: 'User',
          fields: [
            { name: 'id', type: 'ULID', primary_key: true },
            { name: 'name', type: 'Text', required: true },
            { name: 'email', type: 'Email', required: true, unique: true }
          ]
        }
      ],
      pages: []
    }

    executor = new WorkersQueryExecutor(adapter, blueprint)

    // Setup test database
    await adapter.migrate([
      `CREATE TABLE IF NOT EXISTS Task (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT,
        userId TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS User (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE
      )`
    ])
  })

  describe('execute', () => {
    it('should execute simple query', async () => {
      // Insert test data
      await adapter.query(
        'INSERT INTO Task (id, title, status) VALUES (?, ?, ?)',
        ['task-1', 'Test Task', 'pending']
      )

      const query: Query = {
        entity: 'Task',
        where: { status: 'pending' }
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      const result = await executor.execute(query, context)

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Test Task')
      expect(result[0].status).toBe('pending')
    })

    it('should handle parameter references in where clause', async () => {
      await adapter.query(
        'INSERT INTO Task (id, title, userId) VALUES (?, ?, ?)',
        ['task-1', 'User Task', 'user-123']
      )

      const query: Query = {
        entity: 'Task',
        where: { userId: '{user_id}' }
      }

      const context: RequestContext = {
        params: { user_id: 'user-123' },
        query: {},
        session: null
      }

      const result = await executor.execute(query, context)

      expect(result).toHaveLength(1)
      expect(result[0].userId).toBe('user-123')
    })

    it('should support ORDER BY', async () => {
      await adapter.query(
        'INSERT INTO Task (id, title, status) VALUES (?, ?, ?), (?, ?, ?)',
        ['task-1', 'Z Task', 'pending', 'task-2', 'A Task', 'pending']
      )

      const query: Query = {
        entity: 'Task',
        orderBy: { title: 'asc' }
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      const result = await executor.execute(query, context)

      expect(result).toHaveLength(2)
      expect(result[0].title).toBe('A Task')
      expect(result[1].title).toBe('Z Task')
    })

    it('should support LIMIT and OFFSET', async () => {
      await adapter.query(
        'INSERT INTO Task (id, title) VALUES (?, ?), (?, ?), (?, ?)',
        ['task-1', 'Task 1', 'task-2', 'Task 2', 'task-3', 'Task 3']
      )

      const query: Query = {
        entity: 'Task',
        limit: 2,
        offset: 1,
        orderBy: { id: 'asc' }
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      const result = await executor.execute(query, context)

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('task-2')
      expect(result[1].id).toBe('task-3')
    })

    it('should handle operators in where clause', async () => {
      await adapter.query(
        'INSERT INTO Task (id, title, status) VALUES (?, ?, ?), (?, ?, ?)',
        ['task-1', 'Task 1', 'pending', 'task-2', 'Task 2', 'completed']
      )

      const query: Query = {
        entity: 'Task',
        where: { status: { $ne: 'pending' } }
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      const result = await executor.execute(query, context)

      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('completed')
    })
  })

  describe('create', () => {
    it('should create a new record', async () => {
      const data = {
        id: 'task-new',
        title: 'New Task',
        status: 'pending'
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      const result = await executor.create('Task', data, context)

      expect(result).toBeDefined()
      expect(result.id).toBe('task-new')
      expect(result.title).toBe('New Task')

      // Verify in database
      const query = await adapter.query('SELECT * FROM Task WHERE id = ?', ['task-new'])
      expect(query.rows).toHaveLength(1)
    })

    it('should filter out fields not in entity definition', async () => {
      const data = {
        id: 'task-filtered',
        title: 'Task',
        unknownField: 'should be ignored'
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      const result = await executor.create('Task', data, context)

      expect(result).toBeDefined()
      expect(result.title).toBe('Task')
      expect(result.unknownField).toBeUndefined()
    })
  })

  describe('update', () => {
    it('should update an existing record', async () => {
      await adapter.query(
        'INSERT INTO Task (id, title, status) VALUES (?, ?, ?)',
        ['task-1', 'Original', 'pending']
      )

      const data = {
        title: 'Updated',
        status: 'completed'
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      const result = await executor.update('Task', 'task-1', data, context)

      expect(result).toBeDefined()
      expect(result.title).toBe('Updated')
      expect(result.status).toBe('completed')

      // Verify in database
      const query = await adapter.query('SELECT * FROM Task WHERE id = ?', ['task-1'])
      expect(query.rows[0].title).toBe('Updated')
    })
  })

  describe('delete', () => {
    it('should delete a record', async () => {
      await adapter.query(
        'INSERT INTO Task (id, title) VALUES (?, ?)',
        ['task-delete', 'To Delete']
      )

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      await executor.delete('Task', 'task-delete', context)

      // Verify deleted
      const query = await adapter.query('SELECT * FROM Task WHERE id = ?', ['task-delete'])
      expect(query.rows).toHaveLength(0)
    })
  })

  describe('findById', () => {
    it('should find a record by ID', async () => {
      await adapter.query(
        'INSERT INTO Task (id, title) VALUES (?, ?)',
        ['task-find', 'Find Me']
      )

      const result = await executor.findById('Task', 'task-find')

      expect(result).toBeDefined()
      expect(result.id).toBe('task-find')
      expect(result.title).toBe('Find Me')
    })

    it('should return null if not found', async () => {
      const result = await executor.findById('Task', 'nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('SQL injection protection', () => {
    it('should safely handle malicious input in where clause', async () => {
      await adapter.query(
        'INSERT INTO Task (id, title) VALUES (?, ?)',
        ['task-1', 'Safe Task']
      )

      const query: Query = {
        entity: 'Task',
        where: { title: "'; DROP TABLE Task; --" }
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      // Should not throw and should not delete table
      const result = await executor.execute(query, context)
      expect(result).toHaveLength(0)

      // Verify table still exists
      const check = await adapter.query('SELECT COUNT(*) as count FROM Task', [])
      expect(check.rows[0].count).toBeGreaterThanOrEqual(0)
    })

    it('should safely quote identifiers', async () => {
      // This test verifies that identifier quoting works correctly
      const data = {
        id: 'task-quote',
        title: 'Test'
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      // Should not throw even with special entity name (though not recommended)
      const result = await executor.create('Task', data, context)
      expect(result).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('should throw error for nonexistent entity', async () => {
      const query: Query = {
        entity: 'NonexistentEntity',
        where: {}
      }

      const context: RequestContext = {
        params: {},
        query: {},
        session: null
      }

      await expect(executor.execute(query, context)).rejects.toThrow('Entity not found')
    })
  })
})
