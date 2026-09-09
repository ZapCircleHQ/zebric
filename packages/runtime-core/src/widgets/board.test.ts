import { describe, it, expect } from 'vitest'
import { renderBoardWidget } from './board.js'
import type { WidgetRenderContext } from './types.js'

function ctx(overrides: Partial<WidgetRenderContext> = {}): WidgetRenderContext {
  return {
    page: { path: '/', title: 'Task Board', queries: { tasks: { entity: 'Task' } } } as any,
    widget: {
      kind: 'board',
      entity: 'Task',
      group_by: 'status',
      rank_field: 'position',
      columns: [
        { value: 'not_started', label: 'Not Started' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'done', label: 'Done' },
      ],
      card: { title: 'title', subtitle: 'description', meta: ['priority'], href: '/tasks/{id}' },
      on_move: { update: { status: '$to.id' } },
      on_toggle: { update: { important: '!$row.important' } },
    } as any,
    blueprint: { entities: [] } as any,
    theme: {} as any,
    data: {
      tasks: [
        { id: 't1', title: 'First', description: 'do it', priority: 'high', status: 'not_started', position: 1 },
        { id: 't2', title: 'Second', status: 'not_started', position: 0 },
        { id: 't3', title: 'Third', status: 'in_progress', position: 0 },
      ],
    },
    ...overrides,
  }
}

describe('renderBoardWidget — inline columns', () => {
  it('renders one section per inline column with its label', () => {
    const html = renderBoardWidget(ctx()).toString()
    expect(html).toContain('data-column-id="not_started"')
    expect(html).toContain('data-column-id="in_progress"')
    expect(html).toContain('data-column-id="done"')
    expect(html).toContain('>Not Started</h2>')
  })

  it('groups items by the group_by field and ranks them by rank_field', () => {
    const html = renderBoardWidget(ctx()).toString()
    // t2 (position 0) should come before t1 (position 1) in Not Started
    expect(html.indexOf('Second')).toBeLessThan(html.indexOf('First'))
    expect(html.indexOf('Third')).toBeGreaterThan(html.indexOf('First'))
  })

  it('renders the card title as a link, plus subtitle and meta chips', () => {
    const html = renderBoardWidget(ctx()).toString()
    expect(html).toContain('<a class="widget-board-card-title" href="/tasks/t1">First</a>')
    expect(html).toContain('widget-board-card-subtitle">do it<')
    expect(html).toContain('widget-board-card-meta-item">high<')
  })

  it('renders empty columns when there is no data', () => {
    const html = renderBoardWidget(ctx({ data: { tasks: [] } })).toString()
    expect(html).toContain('data-column-id="not_started"')
    expect(html).toContain('widget-board-column-count">0<')
  })
})
