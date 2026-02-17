import { describe, it, expect, beforeEach } from 'vitest'
import { ComponentRenderers } from './component-renderers.js'
import { RendererUtils } from './renderer-utils.js'
import { defaultTheme } from './theme.js'
import type { Blueprint, Page } from '../types/blueprint.js'

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    version: '1.0',
    project: { name: 'Test', version: '1.0.0', runtime: { min_version: '0.1.0' } },
    entities: [
      {
        name: 'Task',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'title', type: 'Text', required: true },
          { name: 'status', type: 'Text' },
        ],
      },
    ],
    pages: [
      { path: '/tasks', title: 'Tasks', layout: 'list', queries: { tasks: { entity: 'Task' } } },
      { path: '/tasks/:id', title: 'Task Detail', layout: 'detail', queries: { task: { entity: 'Task' } } },
      { path: '/tasks/new', title: 'New Task', layout: 'form', form: { entity: 'Task', method: 'create', fields: [] } },
      { path: '/tasks/:id/edit', title: 'Edit Task', layout: 'form', form: { entity: 'Task', method: 'update', fields: [] } },
    ],
    ...overrides,
  } as any
}

describe('ComponentRenderers', () => {
  let blueprint: Blueprint
  let utils: RendererUtils
  let renderer: ComponentRenderers

  beforeEach(() => {
    blueprint = makeBlueprint()
    utils = new RendererUtils(blueprint)
    renderer = new ComponentRenderers(blueprint, defaultTheme, utils)
  })

  describe('renderPageHeader', () => {
    it('renders page title', () => {
      const page: Page = { path: '/tasks', title: 'All Tasks', layout: 'list' }
      const result = renderer.renderPageHeader(page).toString()
      expect(result).toContain('All Tasks')
    })

    it('renders create button when entity is provided', () => {
      const page: Page = { path: '/tasks', title: 'Tasks', layout: 'list' }
      const entity = { name: 'Task', fields: [] }
      const result = renderer.renderPageHeader(page, entity).toString()
      expect(result).toContain('New Task')
      expect(result).toContain('href=')
    })

    it('omits create button when no entity', () => {
      const page: Page = { path: '/tasks', title: 'Tasks', layout: 'list' }
      const result = renderer.renderPageHeader(page).toString()
      expect(result).not.toContain('New')
    })
  })

  describe('renderTable', () => {
    it('renders items in rows', () => {
      const items = [
        { id: '1', title: 'Task 1', status: 'open' },
        { id: '2', title: 'Task 2', status: 'done' },
      ]
      const entity = blueprint.entities[0]
      const result = renderer.renderTable(items, entity).toString()
      expect(result).toContain('Task 1')
      expect(result).toContain('Task 2')
      expect(result).toContain('2 rows of data')
    })

    it('renders singular row count for one item', () => {
      const items = [{ id: '1', title: 'Task 1', status: 'open' }]
      const entity = blueprint.entities[0]
      const result = renderer.renderTable(items, entity).toString()
      expect(result).toContain('1 row of data')
    })

    it('renders empty table message', () => {
      const entity = blueprint.entities[0]
      const result = renderer.renderTable([], entity).toString()
      expect(result).toContain('No rows to display')
      expect(result).toContain('0 rows of data')
    })

    it('renders View and Edit action links', () => {
      const items = [{ id: '1', title: 'Task 1', status: 'open' }]
      const entity = blueprint.entities[0]
      const result = renderer.renderTable(items, entity).toString()
      expect(result).toContain('View')
      expect(result).toContain('Edit')
    })

    it('renders table headers from entity fields', () => {
      const items = [{ id: '1', title: 'Test', status: 'open' }]
      const entity = blueprint.entities[0]
      const result = renderer.renderTable(items, entity).toString()
      expect(result).toContain('Title')
      expect(result).toContain('Status')
      expect(result).toContain('Actions')
    })
  })

  describe('renderDetailFields', () => {
    it('renders fields as definition list', () => {
      const record = { id: '1', title: 'My Task', status: 'open' }
      const entity = blueprint.entities[0]
      const result = renderer.renderDetailFields(record, entity).toString()
      expect(result).toContain('Title')
      expect(result).toContain('My Task')
      expect(result).toContain('Status')
      expect(result).toContain('open')
    })

    it('renders without entity using record keys', () => {
      const record = { id: '1', customField: 'value' }
      const result = renderer.renderDetailFields(record).toString()
      expect(result).toContain('Custom Field')
      expect(result).toContain('value')
    })
  })

  describe('renderDetailActions', () => {
    it('returns empty string when no entity provided', () => {
      const result = renderer.renderDetailActions({ id: '1' }).toString()
      expect(result.trim()).toBe('')
    })

    it('renders edit and delete buttons when entity is provided', () => {
      const entity = { name: 'Task', fields: [] }
      const result = renderer.renderDetailActions({ id: '1' }, entity).toString()
      expect(result).toContain('Edit')
      expect(result).toContain('Delete')
    })
  })

  describe('renderActionBar', () => {
    it('returns empty when page has no actionBar config', () => {
      const page: Page = { path: '/tasks/1', title: 'Task', layout: 'detail' }
      const result = renderer.renderActionBar(page, { id: '1' }).toString()
      expect(result.trim()).toBe('')
    })

    it('renders status badge when entity has status field', () => {
      const page: Page = {
        path: '/tasks/1',
        title: 'Task',
        layout: 'detail',
        actionBar: { actions: [] },
      } as any
      const entity = { name: 'Task', fields: [{ name: 'status', type: 'Text' }] }
      const result = renderer.renderActionBar(page, { id: '1', status: 'in_progress' }, entity).toString()
      expect(result).toContain('in_progress')
    })

    it('renders primary action buttons', () => {
      const page: Page = {
        path: '/tasks/1',
        title: 'Task',
        layout: 'detail',
        actionBar: {
          actions: [{ label: 'Approve', href: '/approve/{id}', method: 'POST' }],
        },
      } as any
      const result = renderer.renderActionBar(page, { id: '1' }, undefined, 'csrf-token-123').toString()
      expect(result).toContain('Approve')
      expect(result).toContain('csrf-token-123')
    })

    it('hides status when showStatus is false', () => {
      const page: Page = {
        path: '/tasks/1',
        title: 'Task',
        layout: 'detail',
        actionBar: { actions: [], showStatus: false },
      } as any
      const entity = { name: 'Task', fields: [{ name: 'status', type: 'Text' }] }
      const result = renderer.renderActionBar(page, { id: '1', status: 'done' }, entity).toString()
      // Without status, title, or description and no actions, the bar should be empty
      expect(result.trim()).toBe('')
    })
  })

  describe('renderFormField', () => {
    it('renders label and input for text field', () => {
      const field = { name: 'title', type: 'text', label: 'Title' }
      const result = renderer.renderFormField(field)
      expect(result).toContain('Title')
      expect(result).toContain('type="text"')
      expect(result).toContain('name="title"')
    })

    it('renders required indicator', () => {
      const field = { name: 'title', type: 'text', required: true }
      const result = renderer.renderFormField(field)
      expect(result).toContain('required')
      expect(result).toContain('*')
    })

    it('populates value from record', () => {
      const field = { name: 'title', type: 'text' }
      const result = renderer.renderFormField(field, { title: 'Existing Title' })
      expect(result).toContain('Existing Title')
    })

    it('renders error message element when error_message present', () => {
      const field = { name: 'title', type: 'text', error_message: 'Field is required' }
      const result = renderer.renderFormField(field)
      expect(result).toContain('Field is required')
      expect(result).toContain('role="alert"')
    })
  })

  describe('renderInput', () => {
    it('renders textarea', () => {
      const field = { name: 'description', type: 'textarea', rows: 6 }
      const result = renderer.renderInput(field, 'Some text')
      expect(result).toContain('<textarea')
      expect(result).toContain('rows="6"')
      expect(result).toContain('Some text')
    })

    it('renders select with options', () => {
      const field = {
        name: 'priority',
        type: 'select',
        options: ['low', 'medium', 'high'],
      }
      const result = renderer.renderInput(field, 'medium')
      expect(result).toContain('<select')
      expect(result).toContain('low')
      expect(result).toContain('medium')
      expect(result).toContain('high')
      expect(result).toContain('selected')
    })

    it('renders select with object options', () => {
      const field = {
        name: 'status',
        type: 'select',
        options: [
          { value: 'open', label: 'Open' },
          { value: 'closed', label: 'Closed' },
        ],
      }
      const result = renderer.renderInput(field, 'open')
      expect(result).toContain('Open')
      expect(result).toContain('Closed')
    })

    it('renders checkbox', () => {
      const field = { name: 'done', type: 'checkbox' }
      const result = renderer.renderInput(field, true)
      expect(result).toContain('type="checkbox"')
      expect(result).toContain('checked')
    })

    it('renders unchecked checkbox', () => {
      const field = { name: 'done', type: 'checkbox' }
      const result = renderer.renderInput(field, false)
      expect(result).toContain('type="checkbox"')
      expect(result).not.toContain('checked')
    })

    it('renders file input with accept', () => {
      const field = { name: 'document', type: 'file', accept: ['.pdf', '.docx'] }
      const result = renderer.renderInput(field, '')
      expect(result).toContain('type="file"')
      expect(result).toContain('.pdf,.docx')
    })

    it('renders date input', () => {
      const field = { name: 'dueDate', type: 'date' }
      const result = renderer.renderInput(field, '2025-01-15')
      expect(result).toContain('type="date"')
      expect(result).toContain('2025-01-15')
    })

    it('renders number input with min/max/step', () => {
      const field = { name: 'quantity', type: 'number', min: 1, max: 100, step: 1 }
      const result = renderer.renderInput(field, 5)
      expect(result).toContain('type="number"')
      expect(result).toContain('min="1"')
      expect(result).toContain('max="100"')
    })

    it('renders default text input for unknown type', () => {
      const field = { name: 'email', type: 'email' }
      const result = renderer.renderInput(field, 'test@example.com')
      expect(result).toContain('type="email"')
      expect(result).toContain('test@example.com')
    })

    it('adds autocomplete attribute for known field names', () => {
      const field = { name: 'email', type: 'text' }
      const result = renderer.renderInput(field, '')
      expect(result).toContain('autocomplete="email"')
    })

    it('adds aria-invalid and aria-describedby when errorId is provided', () => {
      const field = { name: 'title', type: 'text' }
      const result = renderer.renderInput(field, '', 'title-error')
      expect(result).toContain('aria-invalid="true"')
      expect(result).toContain('aria-describedby="title-error"')
    })
  })

  describe('renderDashboardWidget', () => {
    it('renders count and recent items', () => {
      const items = [
        { id: '1', title: 'Task 1' },
        { id: '2', title: 'Task 2' },
        { id: '3', title: 'Task 3' },
      ]
      const result = renderer.renderDashboardWidget('tasks', items, blueprint.entities[0]).toString()
      expect(result).toContain('3')
      expect(result).toContain('Task 1')
      expect(result).toContain('Task 2')
      expect(result).toContain('Task 3')
    })

    it('renders zero count for empty items', () => {
      const result = renderer.renderDashboardWidget('tasks', [], blueprint.entities[0]).toString()
      expect(result).toContain('0')
    })

    it('limits recent items to 5', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: `Task ${i}` }))
      const result = renderer.renderDashboardWidget('tasks', items, blueprint.entities[0]).toString()
      expect(result).toContain('10') // count
      expect(result).toContain('Task 0')
      expect(result).toContain('Task 4')
      expect(result).not.toContain('Task 5') // only first 5 shown
    })
  })

  describe('renderChecklist', () => {
    it('renders items with status', () => {
      const items = [
        { id: '1', title: 'Setup project', status: 'done' },
        { id: '2', title: 'Write tests', status: 'in_progress' },
      ]
      const result = renderer.renderChecklist(items).toString()
      expect(result).toContain('Setup project')
      expect(result).toContain('Write tests')
      expect(result).toContain('done')
    })

    it('renders due date when present', () => {
      const items = [{ id: '1', title: 'Task', status: 'open', dueDate: '2025-01-15' }]
      const result = renderer.renderChecklist(items).toString()
      expect(result).toContain('Due')
    })

    it('applies green color for completed statuses', () => {
      const items = [{ id: '1', title: 'Done Task', status: 'completed' }]
      const result = renderer.renderChecklist(items).toString()
      expect(result).toContain('text-green-600')
    })
  })

  describe('renderRampTimeline', () => {
    it('renders timeline items', () => {
      const items = [
        { id: '1', title: 'Milestone 1', status: 'approved' },
        { id: '2', title: 'Milestone 2', status: 'pending' },
      ]
      const result = renderer.renderRampTimeline(items).toString()
      expect(result).toContain('Milestone 1')
      expect(result).toContain('Milestone 2')
      expect(result).toContain('bg-green-600') // approved status
      expect(result).toContain('bg-gray-300') // pending status
    })
  })

  describe('renderActivityFeed', () => {
    it('renders activity items', () => {
      const items = [
        { id: '1', title: 'Created issue', timestamp: '2025-01-15T10:00:00Z' },
        { id: '2', summary: 'Updated status' },
      ]
      const result = renderer.renderActivityFeed(items).toString()
      expect(result).toContain('Created issue')
      expect(result).toContain('Updated status')
    })

    it('falls back to "Event" when no title or summary', () => {
      const items = [{ id: '1' }]
      const result = renderer.renderActivityFeed(items).toString()
      expect(result).toContain('Event')
    })
  })

  describe('renderError', () => {
    it('renders error message', () => {
      const result = renderer.renderError('Something went wrong').toString()
      expect(result).toContain('Something went wrong')
    })

    it('escapes HTML in error message', () => {
      const result = renderer.renderError('<script>alert("xss")</script>').toString()
      expect(result).not.toContain('<script>')
      expect(result).toContain('&lt;script&gt;')
    })
  })
})
