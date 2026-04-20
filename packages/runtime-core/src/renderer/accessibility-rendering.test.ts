import { describe, expect, it } from 'vitest'
import { HTMLRenderer } from './html-renderer.js'
import type { Blueprint, Page } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    version: '1.0',
    project: {
      name: 'A11y App',
      version: '1.0.0',
      runtime: { min_version: '0.1.0' },
    },
    entities: [
      {
        name: 'Task',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'title', type: 'Text', required: true },
          { name: 'description', type: 'LongText' },
          { name: 'status', type: 'Text' },
        ],
      },
    ],
    pages: [
      { path: '/', title: 'Home', layout: 'dashboard' },
      { path: '/tasks', title: 'Tasks', layout: 'list', queries: { tasks: { entity: 'Task' } } },
      { path: '/tasks/new', title: 'New Task', layout: 'form', form: { entity: 'Task', method: 'create', fields: [] } },
      { path: '/tasks/:id', title: 'Task Detail', layout: 'detail', queries: { task: { entity: 'Task' } } },
    ],
    ...overrides,
  } as any
}

function renderPage(blueprint: Blueprint, page: Page, context: Partial<RenderContext> = {}): string {
  const renderer = new HTMLRenderer(blueprint)
  return renderer.renderPage({
    page,
    data: {},
    params: {},
    query: {},
    ...context,
  } as RenderContext)
}

describe('accessibility rendering invariants', () => {
  it('keeps skip link and main landmark when navigation is disabled', () => {
    const blueprint = makeBlueprint({
      ux: {
        navigation: { model: 'none' },
      },
    })
    const page = blueprint.pages[0]

    const html = renderPage(blueprint, page, { data: {} })

    expect(html).toContain('href="#main-content"')
    expect(html).toContain('Skip to main content')
    expect(html).toContain('id="main-content"')
    expect(html).toContain('role="main"')
    expect(html).toContain('aria-label="Main content"')
    expect(html).not.toContain('Primary navigation')
  })

  it('renders navigation labels and current-page state for sidebar navigation', () => {
    const blueprint = makeBlueprint({
      ux: {
        navigation: {
          model: 'sidebar',
          primary: ['Home', 'Tasks'],
        },
      },
    })
    const page = blueprint.pages[1]

    const html = renderPage(blueprint, page, {
      data: { tasks: [] },
    })

    expect(html).toContain('aria-label="Primary navigation"')
    expect(html).toContain('data-zebric-navigation-model="sidebar"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('aria-label="A11y App home"')
  })

  it('keeps table captions, scoped headers, and contextual action labels with row-click enabled', () => {
    const blueprint = makeBlueprint({
      ux: {
        data: { density: 'compact' },
        interaction: { row_click: 'open-detail' },
      },
    })
    const page = blueprint.pages[1]

    const html = renderPage(blueprint, page, {
      data: {
        tasks: [{ id: '1', title: 'Ship accessibility tests', status: 'open' }],
      },
    })

    expect(html).toContain('<caption class="sr-only">Task list</caption>')
    expect(html).toContain('scope="col"')
    expect(html).toContain('data-row-click="open-detail"')
    expect(html).toContain('aria-label="View Ship accessibility tests details"')
    expect(html).toContain('aria-label="Edit Ship accessibility tests"')
  })

  it('associates sectioned forms with labels, required state, and error announcements', () => {
    const blueprint = makeBlueprint()
    const page: Page = {
      path: '/tasks/new',
      title: 'New Task',
      layout: 'form',
      ux: { pattern: 'form-page@v1' },
      form: {
        entity: 'Task',
        method: 'create',
        fields: [
          {
            name: 'title',
            type: 'text',
            label: 'Title',
            required: true,
            error_message: 'Title is required',
          },
          { name: 'description', type: 'textarea', label: 'Description' },
        ],
        sections: [
          {
            title: 'Basics',
            layout: 'two-column',
            fields: [{ name: 'title' }, { name: 'description' }],
          },
        ],
      },
    }

    const html = renderPage(blueprint, page)

    expect(html).toContain('id="form-title"')
    expect(html).toContain('aria-labelledby="form-title"')
    expect(html).toContain('<label for="title"')
    expect(html).toContain('required aria-required="true"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-describedby="title-error"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-label="required"')
    expect(html).toContain('data-zebric-primitive="section"')
  })

  it('renders toast feedback as a live region without removing main content semantics', () => {
    const blueprint = makeBlueprint({
      ux: {
        system: {
          feedback: {
            success: 'toast',
            error: 'inline',
          },
        },
      },
    })
    const page = blueprint.pages[0]

    const html = renderPage(blueprint, page, {
      flash: { type: 'success', text: 'Saved.' },
    })

    expect(html).toContain('data-zebric-feedback="toast"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('id="main-content"')
    expect(html).toContain('Saved.')
  })
})
