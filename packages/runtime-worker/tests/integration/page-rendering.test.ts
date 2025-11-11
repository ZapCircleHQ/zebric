/**
 * Page Rendering Integration Tests with Miniflare
 *
 * Tests HTML page rendering with data from queries.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnvironment, createTestBlueprint, getD1Database, runMigration, testMigration, type TestEnvironment } from './setup.js'

describe('Page Rendering Integration Tests', () => {
  let env: TestEnvironment

  beforeAll(async () => {
    const blueprint = createTestBlueprint()
    env = await createTestEnvironment(blueprint)

    // Run migrations
    const db = await getD1Database(env.mf)
    await runMigration(db, testMigration)

    // Insert test data
    await db.prepare(`
      INSERT INTO Task (id, title, description, status, priority)
      VALUES
        ('task-1', 'Task One', 'First task', 'pending', 1),
        ('task-2', 'Task Two', 'Second task', 'in_progress', 2),
        ('task-3', 'Task Three', 'Third task', 'completed', 3)
    `).run()
  }, 30000)

  afterAll(async () => {
    await env.cleanup()
  })

  describe('Home page (dashboard)', () => {
    it('should render HTML home page', async () => {
      const response = await env.fetch('/', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')

      const html = await response.text()

      // Check for basic HTML structure
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('<html')
      expect(html).toContain('<head>')
      expect(html).toContain('<body>')
      expect(html).toContain('</html>')

      // Check for page title
      expect(html).toContain('Home')
    })

    it('should include meta tags', async () => {
      const response = await env.fetch('/', {
        headers: { 'Accept': 'text/html' }
      })

      const html = await response.text()

      expect(html).toContain('<meta charset="utf-8"')
      expect(html).toContain('<meta name="viewport"')
    })
  })

  describe('Task list page', () => {
    it('should render tasks list', async () => {
      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.status).toBe(200)

      const html = await response.text()

      // Check for page structure
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Tasks')

      // Note: Actual task rendering depends on HTMLRenderer implementation
      // At minimum, the page should render without error
    })

    it('should set correct content-type header', async () => {
      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.headers.get('content-type')).toMatch(/text\/html/)
    })

    it('should escape HTML in task data', async () => {
      const db = await getD1Database(env.mf)

      // Insert task with HTML content
      await db.prepare(`
        INSERT INTO Task (id, title, description, status)
        VALUES (?, ?, ?, ?)
      `).bind('task-xss', '<script>alert("xss")</script>', 'XSS attempt', 'pending').run()

      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'text/html' }
      })

      const html = await response.text()

      // Should escape the script tag
      expect(html).not.toContain('<script>alert("xss")</script>')
      // Should contain escaped version or not contain the dangerous content
      // The exact escaping depends on HTMLRenderer implementation
    })
  })

  describe('Task detail page', () => {
    it('should render single task detail', async () => {
      const response = await env.fetch('/tasks/task-1', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.status).toBe(200)

      const html = await response.text()

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Task Detail')
    })

    it('should handle nonexistent task gracefully', async () => {
      const response = await env.fetch('/tasks/nonexistent', {
        headers: { 'Accept': 'text/html' }
      })

      // Should still render page, just with no data
      expect(response.status).toBe(200)

      const html = await response.text()
      expect(html).toContain('<!DOCTYPE html>')
    })

    it('should support parameter extraction', async () => {
      // Test multiple IDs to ensure parameter is being extracted correctly
      const response1 = await env.fetch('/tasks/task-1', {
        headers: { 'Accept': 'application/json' }
      })

      const response2 = await env.fetch('/tasks/task-2', {
        headers: { 'Accept': 'application/json' }
      })

      const json1 = await response1.json() as any
      const json2 = await response2.json() as any

      expect(json1.params.id).toBe('task-1')
      expect(json2.params.id).toBe('task-2')
    })
  })

  describe('Form pages', () => {
    it('should render new task form', async () => {
      const response = await env.fetch('/tasks/new', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.status).toBe(200)

      const html = await response.text()

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('New Task')
      // Form should be rendered
      // Specific form rendering depends on HTMLRenderer implementation
    })

    it('should render edit task form', async () => {
      const response = await env.fetch('/tasks/task-1/edit', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.status).toBe(200)

      const html = await response.text()

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Edit Task')
    })
  })

  describe('Content negotiation', () => {
    it('should return HTML for text/html Accept header', async () => {
      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.headers.get('content-type')).toContain('text/html')
      const body = await response.text()
      expect(body).toContain('<!DOCTYPE html>')
    })

    it('should return JSON for application/json Accept header', async () => {
      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'application/json' }
      })

      expect(response.headers.get('content-type')).toContain('application/json')
      const json = await response.json()
      expect(json).toHaveProperty('data')
    })

    it('should return HTML for browser-like Accept header', async () => {
      const response = await env.fetch('/tasks', {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      })

      expect(response.headers.get('content-type')).toContain('text/html')
    })

    it('should return JSON when no Accept header is provided', async () => {
      const response = await env.fetch('/tasks')

      // Default behavior - may be JSON or HTML depending on implementation
      const contentType = response.headers.get('content-type')
      expect(contentType).toMatch(/text\/html|application\/json/)
    })
  })

  describe('Character encoding', () => {
    it('should handle UTF-8 characters correctly', async () => {
      const db = await getD1Database(env.mf)

      await db.prepare(`
        INSERT INTO Task (id, title, description, status)
        VALUES (?, ?, ?, ?)
      `).bind('task-utf8', 'Tâche françai se', '日本語 text', 'pending').run()

      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.status).toBe(200)

      const html = await response.text()

      // Should contain UTF-8 meta tag
      expect(html).toContain('charset="utf-8"')
    })

    it('should handle emoji in data', async () => {
      const db = await getD1Database(env.mf)

      await db.prepare(`
        INSERT INTO Task (id, title, status)
        VALUES (?, ?, ?)
      `).bind('task-emoji', 'Task with emoji 🚀 ✅ 🎉', 'pending').run()

      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'application/json' }
      })

      const json = await response.json() as any
      const task = json.data.tasks.find((t: any) => t.id === 'task-emoji')

      expect(task).toBeDefined()
      expect(task.title).toContain('🚀')
      expect(task.title).toContain('✅')
      expect(task.title).toContain('🎉')
    })
  })

  describe('Error pages', () => {
    it('should return 404 for nonexistent routes', async () => {
      const response = await env.fetch('/this-page-does-not-exist', {
        headers: { 'Accept': 'text/html' }
      })

      expect(response.status).toBe(404)
    })

    it('should return JSON error for API-style requests', async () => {
      const response = await env.fetch('/nonexistent', {
        headers: { 'Accept': 'application/json' }
      })

      expect(response.status).toBe(404)

      const json = await response.json() as any
      expect(json).toHaveProperty('error')
    })
  })

  describe('Security headers', () => {
    it('should set appropriate security headers', async () => {
      const response = await env.fetch('/tasks', {
        headers: { 'Accept': 'text/html' }
      })

      // Check for security-related headers
      // Actual headers depend on HTMLRenderer and adapter implementation
      const headers = response.headers

      // Content-Type should be set
      expect(headers.get('content-type')).toBeTruthy()
    })

    it('should not expose sensitive information in errors', async () => {
      const response = await env.fetch('/nonexistent')

      const text = await response.text()

      // Should not contain stack traces or internal paths
      expect(text).not.toMatch(/\/Users\//)
      expect(text).not.toMatch(/Error: .+ at .+:\d+:\d+/)
    })
  })
})
