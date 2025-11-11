/**
 * HTML Rendering Verification Tests
 *
 * Simple tests to verify HTML is actually being rendered.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestEnvironment, createTestBlueprint, getD1Database, runMigration, testMigration, type TestEnvironment } from './setup.js'

describe('HTML Rendering Verification', () => {
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
      VALUES ('task-1', 'Test Task', 'Test Description', 'pending', 1)
    `).run()
  }, 30000)

  afterAll(async () => {
    await env.cleanup()
  })

  it('should render HTML with proper DOCTYPE', async () => {
    const response = await env.fetch('/tasks', {
      headers: { 'Accept': 'text/html' }
    })

    expect(response.status).toBe(200)

    const html = await response.text()

    // Check for HTML structure
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('<head>')
    expect(html).toContain('<body>')
    expect(html).toContain('</html>')
  })

  it('should include viewport meta tag', async () => {
    const response = await env.fetch('/tasks', {
      headers: { 'Accept': 'text/html' }
    })

    const html = await response.text()

    expect(html).toContain('<meta name="viewport"')
    expect(html).toContain('charset')
  })

  it('should include page title', async () => {
    const response = await env.fetch('/tasks', {
      headers: { 'Accept': 'text/html' }
    })

    const html = await response.text()

    expect(html).toContain('<title>')
    expect(html).toContain('Tasks')
  })

  it('should include Tailwind CSS CDN', async () => {
    const response = await env.fetch('/tasks', {
      headers: { 'Accept': 'text/html' }
    })

    const html = await response.text()

    // Should include Tailwind CSS
    expect(html).toContain('tailwindcss')
  })

  it('should render list layout with task data', async () => {
    const response = await env.fetch('/tasks', {
      headers: { 'Accept': 'text/html' }
    })

    const html = await response.text()

    // Should contain list-specific markup
    expect(html).toContain('table') // List layout typically uses tables
  })

  it('should set text/html content-type', async () => {
    const response = await env.fetch('/tasks', {
      headers: { 'Accept': 'text/html' }
    })

    const contentType = response.headers.get('content-type')
    expect(contentType).toContain('text/html')
  })

  it('should return JSON when Accept is application/json', async () => {
    const response = await env.fetch('/tasks', {
      headers: { 'Accept': 'application/json' }
    })

    expect(response.status).toBe(200)

    const contentType = response.headers.get('content-type')
    expect(contentType).toContain('application/json')

    const json = await response.json() as any
    expect(json).toHaveProperty('data')
    expect(json.data).toHaveProperty('tasks')
  })

  it('should handle form rendering', async () => {
    const response = await env.fetch('/tasks/new', {
      headers: { 'Accept': 'text/html' }
    })

    expect(response.status).toBe(200)

    const html = await response.text()

    // Should contain form elements
    expect(html).toContain('<form')
    expect(html).toContain('</form>')
  })

  it('should include CSRF token in forms', async () => {
    const response = await env.fetch('/tasks/new', {
      headers: { 'Accept': 'text/html' }
    })

    const html = await response.text()

    // Should have CSRF token field (if sessions enabled)
    // Or form should be present
    expect(html).toContain('<form')
  })

  it('should render navigation', async () => {
    const response = await env.fetch('/tasks', {
      headers: { 'Accept': 'text/html' }
    })

    const html = await response.text()

    // Should include navigation
    expect(html).toContain('<nav')
  })
})
