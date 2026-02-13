/**
 * HTML Renderer - Layout Slots Integration Tests
 *
 * Tests for the slot-based customization system for built-in layouts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { HTMLRenderer } from './html-renderer.js'
import type { Blueprint, Page, Entity } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'
import { MemoryTemplateRegistry, InlineTemplateLoader } from './template-system.js'

describe('HTMLRenderer - Layout Slots', () => {
  let blueprint: Blueprint
  let renderer: HTMLRenderer
  let templateRegistry: MemoryTemplateRegistry
  let templateLoader: InlineTemplateLoader

  beforeEach(() => {
    blueprint = {
      version: '1.0',
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
            { name: 'status', type: 'Text' },
            { name: 'createdAt', type: 'DateTime' }
          ]
        }
      ],
      pages: []
    }

    templateRegistry = new MemoryTemplateRegistry()
    templateLoader = new InlineTemplateLoader()
    renderer = new HTMLRenderer(blueprint, undefined, templateRegistry, templateLoader)
  })

  describe('List Layout Slots', () => {
    it('should render default list layout without slots', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: {
          tasks: {
            entity: 'Task',
            orderBy: { createdAt: 'desc' }
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [
          { id: '1', title: 'Task 1', status: 'active' },
          { id: '2', title: 'Task 2', status: 'done' }
        ]},
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('Tasks')
      expect(html).toContain('Task 1')
      expect(html).toContain('Task 2')
      expect(html).toContain('href="&#x2F;tasks&#x2F;1"')
    })

    it('should render an empty table with zero-row description when list has no data', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: {
          tasks: { entity: 'Task' }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [] },
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('<table')
      expect(html).toContain('0 rows of data')
      expect(html).toContain('No rows to display.')
      expect(html).not.toContain('Create first task')
    })

    it('should override list.header slot', () => {
      const page: Page = {
        path: '/tasks',
        title: 'My Tasks',
        layout: 'list',
        queries: {
          tasks: { entity: 'Task' }
        },
        layoutSlots: {
          'list.header': {
            engine: 'liquid',
            type: 'inline',
            source: '<div class="custom-header"><h1>{{ page.title }} - Custom</h1></div>'
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [] },
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('custom-header')
      expect(html).toContain('My Tasks - Custom')
    })

    it('should override list.empty slot', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: {
          tasks: { entity: 'Task' }
        },
        layoutSlots: {
          'list.empty': {
            engine: 'liquid',
            type: 'inline',
            source: '<div class="no-tasks">No tasks yet. Create your first task!</div>'
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [] },
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('no-tasks')
      expect(html).toContain('Create your first task')
    })

    it('should override list.body slot', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: {
          tasks: { entity: 'Task' }
        },
        layoutSlots: {
          'list.body': {
            engine: 'liquid',
            type: 'inline',
            source: `
              <div class="custom-list">
                {% for task in renderer.slot.items %}
                  <div class="custom-item">{{ task.title }}</div>
                {% endfor %}
              </div>
            `
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [
          { id: '1', title: 'Task 1' },
          { id: '2', title: 'Task 2' }
        ]},
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('custom-list')
      expect(html).toContain('custom-item')
      expect(html).toContain('Task 1')
      expect(html).toContain('Task 2')
    })

    it('should access slot context data', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: {
          tasks: { entity: 'Task' }
        },
        layoutSlots: {
          'list.header': {
            engine: 'liquid',
            type: 'inline',
            source: '<div>Entity: {{ renderer.slot.entity.name }}</div>'
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [] },
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('Entity: Task')
    })
  })

  describe('Detail Layout Slots', () => {
    it('should override detail.main slot', () => {
      const page: Page = {
        path: '/tasks/:id',
        title: 'Task Details',
        layout: 'detail',
        queries: {
          task: { entity: 'Task' }
        },
        layoutSlots: {
          'detail.main': {
            engine: 'liquid',
            type: 'inline',
            source: `
              <div class="custom-detail">
                <h1>{{ renderer.slot.record.title }}</h1>
                <p>Status: {{ renderer.slot.record.status }}</p>
              </div>
            `
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { task: { id: '1', title: 'Important Task', status: 'active' }},
        params: { id: '1' },
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('custom-detail')
      expect(html).toContain('Important Task')
      expect(html).toContain('Status: active')
    })

    it('should override detail.related slot', () => {
      const page: Page = {
        path: '/tasks/:id',
        title: 'Task Details',
        layout: 'detail',
        queries: {
          task: { entity: 'Task' }
        },
        layoutSlots: {
          'detail.related': {
            engine: 'liquid',
            type: 'inline',
            source: '<div class="custom-related">Custom related section</div>'
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { task: { id: '1', title: 'Task' }},
        params: { id: '1' },
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('custom-related')
      expect(html).toContain('Custom related section')
    })
  })

  describe('Form Layout Slots', () => {
    it('should render object-based select options with their labels', () => {
      const page: Page = {
        path: '/requests/new',
        title: 'Capture Request',
        layout: 'form',
        form: {
          entity: 'Task',
          method: 'create',
          fields: [
            {
              name: 'source',
              type: 'select',
              label: 'Source',
              default: 'slack',
              options: [
                { value: 'slack', label: 'Slack' },
                { value: 'github', label: 'GitHub' }
              ]
            }
          ]
        }
      }

      const context: RenderContext = {
        page,
        data: {},
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('<option value="slack" selected>')
      expect(html).toContain('Slack')
      expect(html).toContain('<option value="github"')
      expect(html).toContain('GitHub')
      expect(html).not.toContain('[object Object]')
    })

    it('should override form.form slot', () => {
      const page: Page = {
        path: '/tasks/new',
        title: 'New Task',
        layout: 'form',
        form: {
          entity: 'Task',
          method: 'create',
          fields: [
            { name: 'title', type: 'text', required: true },
            { name: 'status', type: 'select', options: ['todo', 'done'] }
          ]
        },
        layoutSlots: {
          'form.form': {
            engine: 'liquid',
            type: 'inline',
            source: `
              <div class="custom-form">
                <h1>{{ page.title }}</h1>
                <form method="POST">
                  <input type="text" name="title" placeholder="Title">
                  <button type="submit">Create Task</button>
                </form>
              </div>
            `
          }
        }
      }

      const context: RenderContext = {
        page,
        data: {},
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('custom-form')
      expect(html).toContain('Create Task')
    })
  })

  describe('Dashboard Layout Slots', () => {
    it('should override dashboard.widgets slot', () => {
      const page: Page = {
        path: '/dashboard',
        title: 'Dashboard',
        layout: 'dashboard',
        queries: {
          tasks: { entity: 'Task', limit: 5 },
          recentTasks: { entity: 'Task', orderBy: { createdAt: 'desc' }, limit: 3 }
        },
        layoutSlots: {
          'dashboard.widgets': {
            engine: 'liquid',
            type: 'inline',
            source: '<div class="custom-widgets">Custom dashboard widgets</div>'
          }
        }
      }

      const context: RenderContext = {
        page,
        data: {
          tasks: [{ id: '1', title: 'Task 1' }],
          recentTasks: [{ id: '2', title: 'Recent Task' }]
        },
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('custom-widgets')
      expect(html).toContain('Custom dashboard widgets')
    })
  })

  describe('Slot Caching', () => {
    it('should cache slot templates for the same page', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' }},
        layoutSlots: {
          'list.header': {
            engine: 'liquid',
            type: 'inline',
            source: '<div>Cached Header {{ page.title }}</div>'
          }
        }
      }

      const context1: RenderContext = {
        page,
        data: { tasks: [] },
        params: {},
        query: {}
      }

      const context2: RenderContext = {
        page,
        data: { tasks: [{ id: '1', title: 'Task' }] },
        params: {},
        query: {}
      }

      // First render should compile and cache
      const html1 = renderer.renderPage(context1)
      expect(html1).toContain('Cached Header Tasks')

      // Second render should use cached template
      const html2 = renderer.renderPage(context2)
      expect(html2).toContain('Cached Header Tasks')
    })
  })

  describe('Slot Error Handling', () => {
    it('should fall back to default when slot template has errors', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' }},
        layoutSlots: {
          'list.header': {
            engine: 'liquid',
            type: 'inline',
            source: '<div>{{ nonexistent.property.chain }}</div>'
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [] },
        params: {},
        query: {}
      }

      // Should not throw, should render default layout
      const html = renderer.renderPage(context)
      expect(html).toContain('Tasks') // Default header should render
    })

    it('should fall back when slot config is missing source', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' }},
        layoutSlots: {
          'list.header': {
            engine: 'liquid',
            type: 'inline',
            source: '' // Empty source
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [] },
        params: {},
        query: {}
      }

      // Should render default or handle gracefully
      const html = renderer.renderPage(context)
      expect(html).toBeDefined()
    })
  })

  describe('Multiple Slots', () => {
    it('should handle multiple slot overrides in the same page', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' }},
        layoutSlots: {
          'list.header': {
            engine: 'liquid',
            type: 'inline',
            source: '<div class="header-slot">Custom Header</div>'
          },
          'list.empty': {
            engine: 'liquid',
            type: 'inline',
            source: '<div class="empty-slot">No items found</div>'
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [] },
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('header-slot')
      expect(html).toContain('Custom Header')
      expect(html).toContain('empty-slot')
      expect(html).toContain('No items found')
    })
  })

  describe('Slot Context Validation', () => {
    it('should provide items array in list.body slot context', () => {
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        queries: { tasks: { entity: 'Task' }},
        layoutSlots: {
          'list.body': {
            engine: 'liquid',
            type: 'inline',
            source: '<div>Item count: {{ renderer.slot.items.size }}</div>'
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { tasks: [
          { id: '1', title: 'Task 1' },
          { id: '2', title: 'Task 2' }
        ]},
        params: {},
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('Item count: 2')
    })

    it('should provide record in detail.main slot context', () => {
      const page: Page = {
        path: '/tasks/:id',
        title: 'Task Details',
        layout: 'detail',
        queries: { task: { entity: 'Task' }},
        layoutSlots: {
          'detail.main': {
            engine: 'liquid',
            type: 'inline',
            source: '<div>Record ID: {{ renderer.slot.record.id }}</div>'
          }
        }
      }

      const context: RenderContext = {
        page,
        data: { task: { id: 'test-123', title: 'Test Task' }},
        params: { id: 'test-123' },
        query: {}
      }

      const html = renderer.renderPage(context)
      expect(html).toContain('Record ID: test-123')
    })
  })
})
