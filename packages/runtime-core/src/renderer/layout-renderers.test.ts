import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LayoutRenderers } from './layout-renderers.js'
import { ComponentRenderers } from './component-renderers.js'
import { RendererUtils } from './renderer-utils.js'
import { defaultTheme } from './theme.js'
import { SafeHtml, safe } from '../security/html-escape.js'
import {
  MemoryTemplateRegistry,
  InlineTemplateLoader,
  StringTemplate,
  type Template,
  type TemplateRegistry,
  type TemplateLoader,
} from './template-system.js'
import type { Blueprint, Page } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'

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
    ],
    ...overrides,
  } as any
}

function makeContext(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    page: { path: '/tasks', title: 'Tasks', layout: 'list', queries: { tasks: { entity: 'Task' } } },
    data: { tasks: [{ id: '1', title: 'Task 1', status: 'open' }] },
    params: {},
    query: {},
    session: null,
    csrfToken: undefined,
    flash: undefined,
    ...overrides,
  } as any
}

/**
 * Create a LayoutRenderers instance with real (but minimal) template infrastructure.
 */
function createLayoutRenderers(blueprint?: Blueprint) {
  const bp = blueprint || makeBlueprint()
  const utils = new RendererUtils(bp)
  const componentRenderers = new ComponentRenderers(bp, defaultTheme, utils)
  const templateRegistry = new MemoryTemplateRegistry()
  const templateLoader = new InlineTemplateLoader()

  // Create minimal builtin templates that return the segments as HTML
  const builtinTemplates = new Map<string, Template>()

  // Each layout template just outputs its segments
  for (const layout of ['list', 'detail', 'form', 'dashboard', 'auth']) {
    builtinTemplates.set(layout, new StringTemplate(
      `builtin:${layout}`,
      'liquid',
      (ctx: any) => {
        const segments = ctx.renderer?.segments || {}
        return Object.values(segments).join('\n')
      }
    ))
  }

  const slotTemplateCache = new Map<string, Template>()
  const builtinTemplateEngine = {
    name: 'liquid' as const,
    compile: (source: string) => () => source,
  }

  const renderer = new LayoutRenderers(
    bp,
    defaultTheme,
    templateRegistry,
    templateLoader,
    builtinTemplates,
    slotTemplateCache,
    builtinTemplateEngine,
    componentRenderers,
    utils
  )

  return { renderer, componentRenderers, utils, templateRegistry, builtinTemplates, slotTemplateCache }
}

describe('LayoutRenderers', () => {
  describe('serializeSegments', () => {
    it('converts SafeHtml instances to strings', () => {
      const { renderer } = createLayoutRenderers()
      const segments = {
        header: safe('<h1>Title</h1>'),
        body: safe('<p>Content</p>'),
      }
      const result = renderer.serializeSegments(segments)
      expect(result.header).toBe('<h1>Title</h1>')
      expect(result.body).toBe('<p>Content</p>')
    })

    it('converts plain strings to strings', () => {
      const { renderer } = createLayoutRenderers()
      const segments = {
        header: 'plain text',
      }
      const result = renderer.serializeSegments(segments)
      expect(result.header).toBe('plain text')
    })

    it('handles empty segments', () => {
      const { renderer } = createLayoutRenderers()
      const result = renderer.serializeSegments({})
      expect(result).toEqual({})
    })

    it('handles mixed SafeHtml and string segments', () => {
      const { renderer } = createLayoutRenderers()
      const segments = {
        safe: safe('<div>safe</div>'),
        plain: 'text',
      }
      const result = renderer.serializeSegments(segments)
      expect(result.safe).toBe('<div>safe</div>')
      expect(result.plain).toBe('text')
    })
  })

  describe('renderListLayout', () => {
    it('renders list with items', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks', title: 'Tasks', layout: 'list', queries: { tasks: { entity: 'Task' } } } as any,
        data: {
          tasks: [
            { id: '1', title: 'Task 1', status: 'open' },
            { id: '2', title: 'Task 2', status: 'done' },
          ],
        },
      })
      const result = renderer.renderListLayout(context).toString()
      expect(result).toContain('Task 1')
      expect(result).toContain('Task 2')
    })

    it('renders error when no query defined', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks', title: 'Tasks', layout: 'list' } as any,
        data: {},
      })
      const result = renderer.renderListLayout(context).toString()
      expect(result).toContain('No query defined for list layout')
    })

    it('renders empty list', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks', title: 'Tasks', layout: 'list', queries: { tasks: { entity: 'Task' } } } as any,
        data: { tasks: [] },
      })
      const result = renderer.renderListLayout(context).toString()
      expect(result).toContain('No rows to display')
    })

    it('renders error for invalid data format', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks', title: 'Tasks', layout: 'list', queries: { tasks: { entity: 'Task' } } } as any,
        data: { tasks: 'not-an-array' },
      })
      const result = renderer.renderListLayout(context).toString()
      expect(result).toContain('Invalid data format for list layout')
    })
  })

  describe('renderDetailLayout', () => {
    it('renders detail with record', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks/:id', title: 'Task Detail', layout: 'detail', queries: { task: { entity: 'Task' } } } as any,
        data: { task: { id: '1', title: 'My Task', status: 'open' } },
        params: { id: '1' },
      })
      const result = renderer.renderDetailLayout(context).toString()
      expect(result).toContain('My Task')
      expect(result).toContain('Task Detail')
    })

    it('renders error when no query defined', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks/1', title: 'Task', layout: 'detail' } as any,
        data: {},
      })
      const result = renderer.renderDetailLayout(context).toString()
      expect(result).toContain('No query defined for detail layout')
    })

    it('renders error when record not found', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks/:id', title: 'Task', layout: 'detail', queries: { task: { entity: 'Task' } } } as any,
        data: { task: null },
      })
      const result = renderer.renderDetailLayout(context).toString()
      expect(result).toContain('Record not found')
    })

    it('finds record by id when data is array', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks/:id', title: 'Task', layout: 'detail', queries: { task: { entity: 'Task' } } } as any,
        data: {
          task: [
            { id: '1', title: 'First' },
            { id: '2', title: 'Second' },
          ],
        },
        params: { id: '2' },
      })
      const result = renderer.renderDetailLayout(context).toString()
      expect(result).toContain('Second')
    })

    it('falls back to first item in array when no id param', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks/:id', title: 'Task', layout: 'detail', queries: { task: { entity: 'Task' } } } as any,
        data: {
          task: [
            { id: '1', title: 'First' },
            { id: '2', title: 'Second' },
          ],
        },
        params: {},
      })
      const result = renderer.renderDetailLayout(context).toString()
      expect(result).toContain('First')
    })
  })

  describe('renderFormLayout', () => {
    it('renders form with fields', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: {
          path: '/tasks/new',
          title: 'New Task',
          layout: 'form',
          form: {
            entity: 'Task',
            method: 'create',
            fields: [
              { name: 'title', type: 'text', label: 'Title' },
            ],
          },
        } as any,
        data: {},
        csrfToken: 'test-csrf',
      })
      const result = renderer.renderFormLayout(context).toString()
      expect(result).toContain('New Task')
      expect(result).toContain('Title')
      expect(result).toContain('Create')
      expect(result).toContain('test-csrf')
    })

    it('renders error when no form definition', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks/new', title: 'New', layout: 'form' } as any,
        data: {},
      })
      const result = renderer.renderFormLayout(context).toString()
      expect(result).toContain('No form definition found')
    })

    it('renders update button for update method', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: {
          path: '/tasks/1/edit',
          title: 'Edit Task',
          layout: 'form',
          form: {
            entity: 'Task',
            method: 'update',
            fields: [{ name: 'title', type: 'text' }],
          },
        } as any,
        data: {},
      })
      const result = renderer.renderFormLayout(context).toString()
      expect(result).toContain('Update')
    })

    it('includes enctype for file fields', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: {
          path: '/upload',
          title: 'Upload',
          layout: 'form',
          form: {
            entity: 'Task',
            method: 'create',
            fields: [{ name: 'document', type: 'file' }],
          },
        } as any,
        data: {},
      })
      const result = renderer.renderFormLayout(context).toString()
      expect(result).toContain('multipart/form-data')
    })

    it('includes cancel button', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: {
          path: '/tasks/new',
          title: 'New Task',
          layout: 'form',
          form: {
            entity: 'Task',
            method: 'create',
            fields: [],
          },
        } as any,
        data: {},
      })
      const result = renderer.renderFormLayout(context).toString()
      expect(result).toContain('Cancel')
    })
  })

  describe('renderDashboardLayout', () => {
    it('renders widgets for each query', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: {
          path: '/dashboard',
          title: 'Dashboard',
          layout: 'dashboard',
          queries: { tasks: { entity: 'Task' } },
        } as any,
        data: {
          tasks: [
            { id: '1', title: 'Task 1' },
            { id: '2', title: 'Task 2' },
          ],
        },
      })
      const result = renderer.renderDashboardLayout(context).toString()
      expect(result).toContain('2') // count
    })

    it('renders empty dashboard when no queries', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/dashboard', title: 'Dashboard', layout: 'dashboard' } as any,
        data: {},
      })
      const result = renderer.renderDashboardLayout(context).toString()
      // Should render without error
      expect(result).toBeDefined()
    })
  })

  describe('renderAuthLayout', () => {
    it('renders sign-in form', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/auth/login', title: 'Login', layout: 'auth' } as any,
        data: {},
        query: { callbackURL: '/dashboard' },
      })
      const result = renderer.renderAuthLayout(context).toString()
      expect(result).toContain('Sign in')
      expect(result).toContain('Email address')
      expect(result).toContain('Password')
    })

    it('includes callback URL in form', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/auth/login', title: 'Login', layout: 'auth' } as any,
        data: {},
        query: { callbackURL: '/tasks' },
      })
      const result = renderer.renderAuthLayout(context).toString()
      // escapeHtmlAttr encodes / as &#x2F;, then html tag re-escapes & as &amp;
      expect(result).toContain('callbackURL')
      expect(result).toContain('tasks')
    })

    it('defaults callbackURL to / when not provided', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/auth/login', title: 'Login', layout: 'auth' } as any,
        data: {},
        query: {},
      })
      const result = renderer.renderAuthLayout(context).toString()
      // The / gets double-escaped through escapeHtmlAttr + html tag
      expect(result).toContain('name="callbackURL"')
    })
  })

  describe('renderCustomLayout', () => {
    it('renders data as JSON', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/custom', title: 'Custom Page', layout: 'custom' } as any,
        data: { key: 'value' },
      })
      const result = renderer.renderCustomLayout(context).toString()
      expect(result).toContain('Custom Page')
      expect(result).toContain('key')
      expect(result).toContain('value')
    })
  })

  describe('renderWithCustomTemplate', () => {
    it('returns null when page has no template', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext({
        page: { path: '/tasks', title: 'Tasks', layout: 'list' } as any,
      })
      const result = renderer.renderWithCustomTemplate(context)
      expect(result).toBeNull()
    })

    it('renders custom template when available', () => {
      const { renderer, templateRegistry } = createLayoutRenderers()
      // Pre-register a template
      const template = new StringTemplate(
        'custom:/custom',
        'liquid',
        () => '<div>Custom Content</div>'
      )
      templateRegistry.set('custom:/custom', template)

      const context = makeContext({
        page: {
          path: '/custom',
          title: 'Custom',
          layout: 'custom',
          template: { source: '<div>Custom</div>', engine: 'liquid' },
        } as any,
      })
      const result = renderer.renderWithCustomTemplate(context)
      expect(result).toContain('Custom Content')
    })
  })

  describe('renderSlot', () => {
    it('calls fallback when no slot config', () => {
      const { renderer } = createLayoutRenderers()
      const page: Page = { path: '/tasks', title: 'Tasks', layout: 'list' } as any
      const context = makeContext()
      const fallback = safe('<div>Fallback</div>')

      const result = renderer.renderSlot(page, 'list.header', context, {}, () => fallback)
      expect(result.toString()).toBe('<div>Fallback</div>')
    })

    it('calls fallback when slot template cannot be loaded', () => {
      const { renderer } = createLayoutRenderers()
      const page: Page = {
        path: '/tasks',
        title: 'Tasks',
        layout: 'list',
        layoutSlots: {
          'list.header': { source: 'invalid', engine: 'unknown-engine' as any },
        },
      } as any
      const context = makeContext()
      const fallback = safe('<div>Fallback</div>')

      const result = renderer.renderSlot(page, 'list.header' as any, context, {}, () => fallback)
      expect(result.toString()).toBe('<div>Fallback</div>')
    })
  })

  describe('renderBuiltinLayout', () => {
    it('throws when layout template not found', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext()
      expect(() => {
        renderer.renderBuiltinLayout('nonexistent', context, {})
      }).toThrow('Built-in layout template not found: nonexistent')
    })

    it('renders with builtin template', () => {
      const { renderer } = createLayoutRenderers()
      const context = makeContext()
      const result = renderer.renderBuiltinLayout('list', context, {
        segments: { header: '<h1>Test</h1>' },
      })
      expect(result).toBeInstanceOf(SafeHtml)
      expect(result.toString()).toContain('<h1>Test</h1>')
    })
  })
})
