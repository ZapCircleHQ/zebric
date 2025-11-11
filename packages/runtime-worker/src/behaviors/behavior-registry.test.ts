/**
 * Behavior Registry Integration Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { BehaviorRegistry } from './behavior-registry.js'
import type { BehaviorContext } from './behavior-registry.js'

describe('BehaviorRegistry', () => {
  let registry: BehaviorRegistry

  beforeEach(() => {
    registry = new BehaviorRegistry()
  })

  describe('registration', () => {
    it('should register behavior function', () => {
      const behavior = (context: BehaviorContext) => '<div>test</div>'

      registry.register('test-behavior', behavior)

      const retrieved = registry.get('test-behavior')
      expect(retrieved).toBe(behavior)
    })

    it('should register multiple behaviors', () => {
      const behavior1 = () => 'test1'
      const behavior2 = () => 'test2'

      registry.register('behavior1', behavior1)
      registry.register('behavior2', behavior2)

      expect(registry.get('behavior1')).toBe(behavior1)
      expect(registry.get('behavior2')).toBe(behavior2)
    })

    it('should initialize with behaviors object', () => {
      const behaviors = {
        'render-tasks': () => '<div>tasks</div>',
        'on-click': () => ({ success: true })
      }

      const newRegistry = new BehaviorRegistry(behaviors)

      expect(newRegistry.get('render-tasks')).toBeDefined()
      expect(newRegistry.get('on-click')).toBeDefined()
    })

    it('should return undefined for nonexistent behavior', () => {
      expect(registry.get('nonexistent')).toBeUndefined()
    })
  })

  describe('executeRender', () => {
    it('should execute render behavior with helpers', async () => {
      const behavior = (context: BehaviorContext) => {
        return `<div>${context.helpers.escapeHtml('<script>alert("xss")</script>')}</div>`
      }

      registry.register('render-test', behavior)

      const context: BehaviorContext = {
        data: {},
        helpers: {} as any, // Helpers will be provided by executeRender
        params: {},
        session: null
      }

      const result = await registry.executeRender('render-test', context)

      expect(result).toContain('&lt;script&gt;')
      expect(result).not.toContain('<script>')
    })

    it('should provide all helper functions', async () => {
      const behavior = (context: BehaviorContext) => {
        const { helpers } = context
        return JSON.stringify({
          today: helpers.today(),
          now: helpers.now(),
          formatDate: helpers.formatDate('2025-01-15'),
          formatDateTime: helpers.formatDateTime('2025-01-15T10:30:00Z'),
          escapeHtml: helpers.escapeHtml('<div>')
        })
      }

      registry.register('test-helpers', behavior)

      const result = await registry.executeRender('test-helpers', {
        data: {},
        helpers: {} as any,
        params: {},
        session: null
      })

      const parsed = JSON.parse(result)

      expect(parsed.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(parsed.now).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(parsed.formatDate).toContain('Jan')
      expect(parsed.formatDateTime).toContain('Jan')
      expect(parsed.escapeHtml).toBe('&lt;div&gt;')
    })

    it('should pass data context', async () => {
      const behavior = (context: BehaviorContext) => {
        const tasks = context.data.tasks || []
        return `<div>Count: ${tasks.length}</div>`
      }

      registry.register('render-tasks', behavior)

      const result = await registry.executeRender('render-tasks', {
        data: { tasks: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        helpers: {} as any,
        params: {},
        session: null
      })

      expect(result).toBe('<div>Count: 3</div>')
    })

    it('should pass params', async () => {
      const behavior = (context: BehaviorContext) => {
        return `<div>ID: ${context.params?.id}</div>`
      }

      registry.register('render-detail', behavior)

      const result = await registry.executeRender('render-detail', {
        data: {},
        helpers: {} as any,
        params: { id: '456' },
        session: null
      })

      expect(result).toBe('<div>ID: 456</div>')
    })

    it('should pass session', async () => {
      const behavior = (context: BehaviorContext) => {
        if (!context.session) {
          return '<div>Guest</div>'
        }
        return `<div>Welcome ${context.session.user.name}</div>`
      }

      registry.register('render-greeting', behavior)

      const resultGuest = await registry.executeRender('render-greeting', {
        data: {},
        helpers: {} as any,
        params: {},
        session: null
      })

      expect(resultGuest).toBe('<div>Guest</div>')

      const resultUser = await registry.executeRender('render-greeting', {
        data: {},
        helpers: {} as any,
        params: {},
        session: {
          id: 'session-123',
          userId: 'user-456',
          user: { id: 'user-456', name: 'Alice' },
          expiresAt: new Date(),
          createdAt: new Date()
        }
      })

      expect(resultUser).toBe('<div>Welcome Alice</div>')
    })

    it('should throw error for nonexistent behavior', async () => {
      await expect(
        registry.executeRender('nonexistent', {
          data: {},
          helpers: {} as any,
          params: {},
          session: null
        })
      ).rejects.toThrow('Behavior not found: nonexistent')
    })

    it('should handle async behavior', async () => {
      const behavior = async (context: BehaviorContext) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return '<div>async result</div>'
      }

      registry.register('async-behavior', behavior)

      const result = await registry.executeRender('async-behavior', {
        data: {},
        helpers: {} as any,
        params: {},
        session: null
      })

      expect(result).toBe('<div>async result</div>')
    })
  })

  describe('executeHandler', () => {
    it('should execute event handler', async () => {
      const handler = (context: BehaviorContext) => {
        return {
          action: 'update',
          entity: 'Task',
          id: context.params?.id,
          data: { status: 'completed' }
        }
      }

      registry.register('on-status-click', handler)

      const result = await registry.executeHandler('on-status-click', {
        data: {},
        helpers: {} as any,
        params: { id: '123' },
        session: null
      })

      expect(result).toEqual({
        action: 'update',
        entity: 'Task',
        id: '123',
        data: { status: 'completed' }
      })
    })

    it('should handle authentication check', async () => {
      const handler = (context: BehaviorContext) => {
        if (!context.session) {
          return { error: 'Authentication required' }
        }
        return { success: true, userId: context.session.userId }
      }

      registry.register('auth-handler', handler)

      const resultGuest = await registry.executeHandler('auth-handler', {
        data: {},
        helpers: {} as any,
        params: {},
        session: null
      })

      expect(resultGuest).toEqual({ error: 'Authentication required' })

      const resultUser = await registry.executeHandler('auth-handler', {
        data: {},
        helpers: {} as any,
        params: {},
        session: {
          id: 'session-123',
          userId: 'user-456',
          user: { id: 'user-456', name: 'Alice' },
          expiresAt: new Date(),
          createdAt: new Date()
        }
      })

      expect(resultUser).toEqual({ success: true, userId: 'user-456' })
    })

    it('should handle async handler', async () => {
      const handler = async (context: BehaviorContext) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { result: 'async' }
      }

      registry.register('async-handler', handler)

      const result = await registry.executeHandler('async-handler', {
        data: {},
        helpers: {} as any,
        params: {},
        session: null
      })

      expect(result).toEqual({ result: 'async' })
    })

    it('should throw error for nonexistent handler', async () => {
      await expect(
        registry.executeHandler('nonexistent', {
          data: {},
          helpers: {} as any,
          params: {},
          session: null
        })
      ).rejects.toThrow('Handler not found: nonexistent')
    })
  })

  describe('helpers', () => {
    it('should format dates consistently', async () => {
      const behavior = (context: BehaviorContext) => {
        return context.helpers.formatDate('2025-01-15')
      }

      registry.register('date-test', behavior)

      const result = await registry.executeRender('date-test', {
        data: {},
        helpers: {} as any,
        params: {},
        session: null
      })

      expect(result).toContain('Jan')
      expect(result).toContain('2025')
      // Don't check day since it may vary by timezone
    })

    it('should escape HTML special characters', async () => {
      const behavior = (context: BehaviorContext) => {
        return context.helpers.escapeHtml('<script>alert("xss")</script>')
      }

      registry.register('escape-test', behavior)

      const result = await registry.executeRender('escape-test', {
        data: {},
        helpers: {} as any,
        params: {},
        session: null
      })

      expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    })

    it('should provide current date/time helpers', async () => {
      const behavior = (context: BehaviorContext) => {
        const today = context.helpers.today()
        const now = context.helpers.now()

        return JSON.stringify({ today, now })
      }

      registry.register('time-test', behavior)

      const result = await registry.executeRender('time-test', {
        data: {},
        helpers: {} as any,
        params: {},
        session: null
      })

      const parsed = JSON.parse(result)

      expect(parsed.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(parsed.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  describe('real-world scenarios', () => {
    it('should render task list with status', async () => {
      const renderTasks = (context: BehaviorContext) => {
        const tasks = context.data.tasks || []
        return `
          <div class="tasks">
            ${tasks.map((task: any) => `
              <div class="task task-${task.status}">
                <h3>${context.helpers.escapeHtml(task.title)}</h3>
                <p>Due: ${context.helpers.formatDate(task.dueDate)}</p>
              </div>
            `).join('')}
          </div>
        `
      }

      registry.register('render-tasks', renderTasks)

      const result = await registry.executeRender('render-tasks', {
        data: {
          tasks: [
            { id: 1, title: 'Task 1', status: 'pending', dueDate: '2025-01-20' },
            { id: 2, title: 'Task 2', status: 'completed', dueDate: '2025-01-15' }
          ]
        },
        helpers: {} as any,
        params: {},
        session: null
      })

      expect(result).toContain('Task 1')
      expect(result).toContain('Task 2')
      expect(result).toContain('task-pending')
      expect(result).toContain('task-completed')
    })

    it('should handle dashboard with statistics', async () => {
      const renderDashboard = (context: BehaviorContext) => {
        const tasks = context.data.tasks || []
        const completed = tasks.filter((t: any) => t.status === 'completed').length
        const total = tasks.length

        return `
          <div class="dashboard">
            <h1>Dashboard</h1>
            <div class="stat">Completed: ${completed}/${total}</div>
          </div>
        `
      }

      registry.register('render-dashboard', renderDashboard)

      const result = await registry.executeRender('render-dashboard', {
        data: {
          tasks: [
            { status: 'completed' },
            { status: 'completed' },
            { status: 'pending' }
          ]
        },
        helpers: {} as any,
        params: {},
        session: null
      })

      expect(result).toContain('Completed: 2/3')
    })
  })
})
