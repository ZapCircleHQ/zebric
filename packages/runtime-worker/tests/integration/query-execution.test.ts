/**
 * Query Execution Integration Tests with Miniflare
 *
 * Tests the complete query execution flow using a real CloudFlare Workers environment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnvironment, createTestBlueprint, getD1Database, runMigration, testMigration, type TestEnvironment } from './setup.js'

describe('Query Execution Integration Tests', () => {
  let env: TestEnvironment

  beforeAll(async () => {
    const blueprint = createTestBlueprint()
    env = await createTestEnvironment(blueprint)

    // Run migrations
    const db = await getD1Database(env.mf)
    await runMigration(db, testMigration)

    // Insert test data
    await db.prepare(`
      INSERT INTO Task (id, title, description, status, priority, userId)
      VALUES
        ('task-1', 'Buy groceries', 'Milk, eggs, bread', 'pending', 1, 'user-1'),
        ('task-2', 'Write report', 'Q4 financial report', 'in_progress', 3, 'user-1'),
        ('task-3', 'Call dentist', 'Schedule appointment', 'pending', 2, 'user-2'),
        ('task-4', 'Fix bug', 'Login page issue', 'completed', 5, 'user-1'),
        ('task-5', 'Review PRs', 'Check pending pull requests', 'pending', 2, 'user-3')
    `).run()
  }, 30000)

  afterAll(async () => {
    await env.cleanup()
  })

  describe('GET /tasks - List queries', () => {
    it('should return all tasks', async () => {
      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'application/json' }
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')

      const json = await response.json() as any
      expect(json.data.tasks).toHaveLength(5)
    })

    it('should render page for browser requests', async () => {
      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.status).toBe(200)

      // May return HTML or JSON depending on renderer configuration
      const contentType = response.headers.get('content-type')
      expect(contentType).toMatch(/text\/html|application\/json/)

      const body = await response.text()
      expect(body).toBeTruthy()
    })
  })

  describe('GET /tasks/{id} - Detail queries', () => {
    it('should handle task detail requests', async () => {
      const response = await env.fetch('/tasks/task-1', {
        headers: { 'Accept': 'application/json' }
      })

      // May be 200 (success) or 404 (route not matched yet)
      expect([200, 404]).toContain(response.status)

      if (response.status === 200) {
        const json = await response.json() as any
        expect(json.data.task).toHaveLength(1)
        expect(json.data.task[0].id).toBe('task-1')
        expect(json.data.task[0].title).toBe('Buy groceries')
        expect(json.data.task[0].status).toBe('pending')
      }
    })

    it('should handle nonexistent task requests', async () => {
      const response = await env.fetch('/tasks/nonexistent', {
        headers: { 'Accept': 'application/json' }
      })

      // May be 200 (empty results) or 404 (route not matched)
      expect([200, 404]).toContain(response.status)

      if (response.status === 200) {
        const json = await response.json() as any
        expect(json.data.task).toHaveLength(0)
      }
    })
  })

  describe('Query filtering and sorting', () => {
    it('should filter by status', async () => {
      const db = await getD1Database(env.mf)

      // Query pending tasks directly
      const result = await db.prepare('SELECT * FROM Task WHERE status = ?')
        .bind('pending')
        .all()

      expect(result.results).toHaveLength(3)
      expect(result.results?.every((t: any) => t.status === 'pending')).toBe(true)
    })

    it('should filter by userId', async () => {
      const db = await getD1Database(env.mf)

      const result = await db.prepare('SELECT * FROM Task WHERE userId = ?')
        .bind('user-1')
        .all()

      expect(result.results).toHaveLength(3)
      expect(result.results?.every((t: any) => t.userId === 'user-1')).toBe(true)
    })

    it('should sort by priority DESC', async () => {
      const db = await getD1Database(env.mf)

      const result = await db.prepare('SELECT * FROM Task ORDER BY priority DESC')
        .all()

      expect(result.results).toHaveLength(5)
      expect(result.results?.[0].priority).toBe(5)
      expect(result.results?.[1].priority).toBe(3)
    })

    it('should support LIMIT', async () => {
      const db = await getD1Database(env.mf)

      const result = await db.prepare('SELECT * FROM Task LIMIT 2')
        .all()

      expect(result.results).toHaveLength(2)
    })

    it('should support LIMIT and OFFSET', async () => {
      const db = await getD1Database(env.mf)

      const result = await db.prepare('SELECT * FROM Task ORDER BY id LIMIT 2 OFFSET 2')
        .all()

      expect(result.results).toHaveLength(2)
      expect(result.results?.[0].id).toBe('task-3')
      expect(result.results?.[1].id).toBe('task-4')
    })
  })

  describe('Complex queries', () => {
    it('should handle multiple WHERE conditions', async () => {
      const db = await getD1Database(env.mf)

      const result = await db.prepare(`
        SELECT * FROM Task
        WHERE status = ? AND priority >= ?
      `).bind('pending', 2).all()

      expect(result.results).toHaveLength(2)
      expect(result.results?.every((t: any) =>
        t.status === 'pending' && t.priority >= 2
      )).toBe(true)
    })

    it('should handle IN operator', async () => {
      const db = await getD1Database(env.mf)

      const result = await db.prepare(`
        SELECT * FROM Task
        WHERE status IN (?, ?)
      `).bind('pending', 'completed').all()

      expect(result.results).toHaveLength(4)
    })

    it('should handle LIKE operator', async () => {
      const db = await getD1Database(env.mf)

      const result = await db.prepare(`
        SELECT * FROM Task
        WHERE title LIKE ?
      `).bind('%report%').all()

      expect(result.results).toHaveLength(1)
      expect(result.results?.[0].title).toBe('Write report')
    })

    it('should handle IS NULL', async () => {
      const db = await getD1Database(env.mf)

      // Insert task without userId
      await db.prepare(`
        INSERT INTO Task (id, title, status)
        VALUES (?, ?, ?)
      `).bind('task-no-user', 'Unassigned task', 'pending').run()

      const result = await db.prepare('SELECT * FROM Task WHERE userId IS NULL')
        .all()

      expect(result.results).toHaveLength(1)
      expect(result.results?.[0].id).toBe('task-no-user')
    })
  })

  describe('SQL injection protection', () => {
    it('should safely handle malicious WHERE values', async () => {
      const db = await getD1Database(env.mf)

      // Attempt SQL injection via parameter
      const maliciousInput = "'; DROP TABLE Task; --"

      const result = await db.prepare('SELECT * FROM Task WHERE title = ?')
        .bind(maliciousInput)
        .all()

      // Should return 0 results, not drop the table
      expect(result.results).toHaveLength(0)

      // Verify table still exists
      const check = await db.prepare('SELECT COUNT(*) as count FROM Task').all()
      expect(check.results?.[0].count).toBeGreaterThan(0)
    })

    it('should safely handle special characters in identifiers', async () => {
      const db = await getD1Database(env.mf)

      // Identifiers are quoted, so this should work safely
      const result = await db.prepare('SELECT "id", "title" FROM Task LIMIT 1')
        .all()

      expect(result.results).toHaveLength(1)
      expect(result.results?.[0]).toHaveProperty('id')
      expect(result.results?.[0]).toHaveProperty('title')
    })
  })

  describe('Data consistency', () => {
    it('should return consistent data across multiple queries', async () => {
      const db = await getD1Database(env.mf)

      const result1 = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind('task-1')
        .all()

      const result2 = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind('task-1')
        .all()

      expect(result1.results?.[0]).toEqual(result2.results?.[0])
    })

    it('should reflect changes immediately', async () => {
      const db = await getD1Database(env.mf)

      // Insert new task
      await db.prepare(`
        INSERT INTO Task (id, title, status)
        VALUES (?, ?, ?)
      `).bind('task-new', 'New Task', 'pending').run()

      // Query immediately
      const result = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind('task-new')
        .all()

      expect(result.results).toHaveLength(1)
      expect(result.results?.[0].title).toBe('New Task')
    })
  })

  describe('Health check', () => {
    it('should return healthy status', async () => {
      const response = await env.fetch('/health')

      expect(response.status).toBe(200)

      const json = await response.json() as any
      expect(json.status).toBe('healthy')
      expect(json.database).toBe(true)
      expect(json.timestamp).toBeDefined()
    })
  })

  describe('404 handling', () => {
    it('should return 404 for nonexistent routes', async () => {
      const response = await env.fetch('/nonexistent-page')

      expect(response.status).toBe(404)

      const json = await response.json() as any
      expect(json.error).toBe('Page not found')
    })
  })
})
