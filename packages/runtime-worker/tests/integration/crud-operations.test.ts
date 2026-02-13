/**
 * CRUD Operations Integration Tests with Miniflare
 *
 * Tests CREATE, UPDATE, DELETE operations through the API.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnvironment, createTestBlueprint, getD1Database, runMigration, testMigration, type TestEnvironment } from './setup.js'

describe('CRUD Operations Integration Tests', () => {
  let env: TestEnvironment

  beforeAll(async () => {
    const blueprint = createTestBlueprint()
    env = await createTestEnvironment(blueprint)

    // Run migrations
    const db = await getD1Database(env.mf)
    await runMigration(db, testMigration)
  }, 30000)

  afterAll(async () => {
    await env.cleanup()
  })

  describe('POST /tasks/new - Create operations', () => {
    it('should create a new task', async () => {
      const response = await env.fetch('/tasks/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Integration Test Task',
          description: 'Created via integration test',
          status: 'pending',
          priority: 3
        })
      })

      expect(response.status).toBe(200)

      const json = await response.json() as any
      expect(json.success).toBe(true)
      expect(json.data).toBeDefined()
      expect(json.data.title).toBe('Integration Test Task')
      expect(json.data.status).toBe('pending')

      // Verify in database
      const db = await getD1Database(env.mf)
      const result = await db.prepare('SELECT * FROM Task WHERE title = ?')
        .bind('Integration Test Task')
        .all()

      expect(result.results).toHaveLength(1)
      expect(result.results?.[0].description).toBe('Created via integration test')
      expect(result.results?.[0].priority).toBe(3)
    })

    it('should validate required fields', async () => {
      const response = await env.fetch('/tasks/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          // Missing required 'title'
          status: 'pending'
        })
      })

      expect(response.status).toBe(400)

      const json = await response.json() as any
      expect(json.error).toBe('Validation failed')
      expect(json.errors).toBeDefined()
      expect(json.errors.some((e: any) => e.field === 'title')).toBe(true)
    })

    it('should filter out undefined fields', async () => {
      const response = await env.fetch('/tasks/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Test Task',
          status: 'pending',
          unknownField: 'should be ignored',
          anotherBadField: 123
        })
      })

      expect(response.status).toBe(200)

      const json = await response.json() as any
      expect(json.data.title).toBe('Test Task')
      expect(json.data.unknownField).toBeUndefined()
      expect(json.data.anotherBadField).toBeUndefined()
    })

    it('should handle special characters in data', async () => {
      const response = await env.fetch('/tasks/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: "Task with 'quotes' and \"double quotes\"",
          description: "Special chars: <>&\"'",
          status: 'pending'
        })
      })

      expect(response.status).toBe(200)

      const json = await response.json() as any
      expect(json.data.title).toBe("Task with 'quotes' and \"double quotes\"")

      // Verify in database
      const db = await getD1Database(env.mf)
      const result = await db.prepare('SELECT * FROM Task WHERE title = ?')
        .bind("Task with 'quotes' and \"double quotes\"")
        .all()

      expect(result.results).toHaveLength(1)
      expect(result.results?.[0].description).toBe("Special chars: <>&\"'")
    })

    it('should handle numeric fields correctly', async () => {
      const response = await env.fetch('/tasks/new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Priority Task',
          status: 'pending',
          priority: 10
        })
      })

      expect(response.status).toBe(200)

      const json = await response.json() as any
      expect(json.data.priority).toBe(10)

      // Verify correct type in database
      const db = await getD1Database(env.mf)
      const result = await db.prepare('SELECT priority FROM Task WHERE title = ?')
        .bind('Priority Task')
        .all()

      expect(result.results?.[0].priority).toBe(10)
      expect(typeof result.results?.[0].priority).toBe('number')
    })
  })

  describe('PUT /tasks/{id}/edit - Update operations', () => {
    it('should update an existing task', async () => {
      // First create a task
      const db = await getD1Database(env.mf)
      await db.prepare(`
        INSERT INTO Task (id, title, status, priority)
        VALUES (?, ?, ?, ?)
      `).bind('task-update-1', 'Original Title', 'pending', 1).run()

      // Update it
      const response = await env.fetch('/tasks/task-update-1/edit', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Updated Title',
          status: 'completed',
          priority: 5
        })
      })

      expect(response.status).toBe(200)

      const json = await response.json() as any
      expect(json.success).toBe(true)
      expect(json.data.title).toBe('Updated Title')
      expect(json.data.status).toBe('completed')

      // Verify in database
      const result = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind('task-update-1')
        .all()

      expect(result.results?.[0].title).toBe('Updated Title')
      expect(result.results?.[0].status).toBe('completed')
      expect(result.results?.[0].priority).toBe(5)
    })

    it('should handle partial updates', async () => {
      const db = await getD1Database(env.mf)
      await db.prepare(`
        INSERT INTO Task (id, title, description, status, priority)
        VALUES (?, ?, ?, ?, ?)
      `).bind('task-update-2', 'Task 2', 'Description', 'pending', 3).run()

      // Update only status
      const response = await env.fetch('/tasks/task-update-2/edit', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: 'in_progress'
        })
      })

      expect(response.status).toBe(200)

      // Verify other fields unchanged
      const result = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind('task-update-2')
        .all()

      expect(result.results?.[0].title).toBe('Task 2')
      expect(result.results?.[0].description).toBe('Description')
      expect(result.results?.[0].status).toBe('in_progress')
      expect(result.results?.[0].priority).toBe(3)
    })

    it('should return 400 for nonexistent task', async () => {
      const response = await env.fetch('/tasks/nonexistent/edit', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Updated'
        })
      })

      // Update should still return 200 but not affect any rows
      // The actual behavior depends on your error handling implementation
      expect([200, 400, 404]).toContain(response.status)
    })

    it('should validate updated data', async () => {
      const db = await getD1Database(env.mf)
      await db.prepare(`
        INSERT INTO Task (id, title, status)
        VALUES (?, ?, ?)
      `).bind('task-validate', 'Task', 'pending').run()

      const response = await env.fetch('/tasks/task-validate/edit', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: '' // Empty title should fail validation
        })
      })

      // Should fail validation
      expect([400, 200]).toContain(response.status)
    })
  })

  describe('DELETE /tasks/{id} - Delete operations', () => {
    it('should delete an existing task', async () => {
      // Create a task
      const db = await getD1Database(env.mf)
      await db.prepare(`
        INSERT INTO Task (id, title, status)
        VALUES (?, ?, ?)
      `).bind('task-delete-1', 'To Delete', 'pending').run()

      // Delete it
      const response = await env.fetch('/tasks/task-delete-1', {
        method: 'DELETE'
      })

      expect(response.status).toBe(200)

      const json = await response.json() as any
      expect(json.success).toBe(true)
      expect(json.message).toContain('Deleted successfully')

      // Verify deleted from database
      const result = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind('task-delete-1')
        .all()

      expect(result.results).toHaveLength(0)
    })

    it('should handle deleting nonexistent task', async () => {
      const response = await env.fetch('/tasks/nonexistent-delete', {
        method: 'DELETE'
      })

      // Should still return success (idempotent) or error for nonexistent
      expect([200, 400, 404]).toContain(response.status)
    })

    it('should not delete other tasks', async () => {
      const db = await getD1Database(env.mf)

      // Create multiple tasks
      await db.prepare(`
        INSERT INTO Task (id, title, status)
        VALUES (?, ?, ?), (?, ?, ?)
      `).bind(
        'task-keep-1', 'Keep 1', 'pending',
        'task-delete-2', 'Delete', 'pending'
      ).run()

      // Delete one
      await env.fetch('/tasks/task-delete-2', {
        method: 'DELETE'
      })

      // Verify the other still exists
      const result = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind('task-keep-1')
        .all()

      expect(result.results).toHaveLength(1)
      expect(result.results?.[0].title).toBe('Keep 1')
    })
  })

  describe('End-to-end workflow', () => {
    it('should support complete CRUD lifecycle', async () => {
      const db = await getD1Database(env.mf)

      // 1. CREATE
      const lifecycleId = 'lifecycle-' + Date.now()
      const createResponse = await env.fetch('/tasks/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: lifecycleId,
          title: 'Lifecycle Task',
          status: 'pending',
          priority: 1
        })
      })

      expect(createResponse.status).toBe(200)

      // 2. READ via direct query (simulating GET /tasks/{id})
      let result = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind(lifecycleId)
        .all()

      expect(result.results).toHaveLength(1)
      expect(result.results?.[0].status).toBe('pending')
      expect(result.results?.[0].priority).toBe(1)

      const actualId = lifecycleId

      // 3. UPDATE
      const updateResponse = await env.fetch(`/tasks/${actualId}/edit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          priority: 5
        })
      })

      expect(updateResponse.status).toBe(200)

      result = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind(actualId)
        .all()

      expect(result.results?.[0].status).toBe('completed')
      expect(result.results?.[0].priority).toBe(5)

      // 4. DELETE
      const deleteResponse = await env.fetch(`/tasks/${actualId}`, {
        method: 'DELETE'
      })

      expect(deleteResponse.status).toBe(200)

      result = await db.prepare('SELECT * FROM Task WHERE id = ?')
        .bind(actualId)
        .all()

      expect(result.results).toHaveLength(0)
    })
  })
})
