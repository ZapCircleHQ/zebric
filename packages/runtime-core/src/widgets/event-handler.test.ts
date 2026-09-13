import { describe, expect, it } from 'vitest'
import { buildUpdatePayload, resolveWidgetEvent } from './event-handler.js'
import type { Blueprint } from '../types/blueprint.js'

function blueprint(widget?: Record<string, any>): Blueprint {
  return {
    version: '1',
    project: { name: 'test', version: '1', runtime: { min_version: '1' } },
    entities: [],
    pages: [{ path: '/tasks', title: 'Tasks', widget } as any],
  }
}

describe('resolveWidgetEvent', () => {
  it('resolves an event update and preserves its workflow', () => {
    const result = resolveWidgetEvent(
      blueprint({
        kind: 'board',
        on_move: {
          update: { status: '$to.id', position: '$index', previousStatus: '$row.status' },
          workflow: 'task-moved',
        },
      }),
      {
        page: '/tasks',
        event: 'move',
        row: { entity: 'Task', id: 'task-1' },
        ctx: { to: { id: 'done' }, index: 2 },
      },
      { status: 'doing' },
    )

    expect(result).toEqual({
      entity: 'Task',
      id: 'task-1',
      update: { status: 'done', position: 2, previousStatus: 'doing' },
      workflow: 'task-moved',
    })
  })

  it('returns null for pages and events without a configured update', () => {
    const configured = blueprint({ kind: 'board', on_move: {} })

    expect(resolveWidgetEvent(configured, {
      page: '/missing', event: 'move', row: { entity: 'Task', id: '1' }, ctx: {},
    }, {})).toBeNull()
    expect(resolveWidgetEvent(configured, {
      page: '/tasks', event: 'edit', row: { entity: 'Task', id: '1' }, ctx: {},
    }, {})).toBeNull()
    expect(resolveWidgetEvent(configured, {
      page: '/tasks', event: 'move', row: { entity: 'Task', id: '1' }, ctx: {},
    }, {})).toBeNull()
  })
})

describe('buildUpdatePayload', () => {
  it('substitutes event, row, and dynamic-field placeholders', () => {
    const result = buildUpdatePayload({
      '$field': '!$row.$field',
      dynamicValue: '$row[$field]',
      dynamicNegated: '!$row[$field]',
      oldTitle: '$row.title',
      oldArchived: '!$row.archived',
      value: '$value',
      field: '$field',
      targetId: '$to.id',
      targetValue: '$to.value',
      position: '$index',
      unchanged: 'literal',
      count: 3,
    }, {
      title: 'Before',
      archived: false,
      featured: true,
    }, {
      field: 'featured',
      value: 'After',
      index: 4,
      to: { id: 'column-2', value: 'done' },
    })

    expect(result).toEqual({
      featured: false,
      dynamicValue: true,
      dynamicNegated: false,
      oldTitle: 'Before',
      oldArchived: true,
      value: 'After',
      field: 'featured',
      targetId: 'column-2',
      targetValue: 'done',
      position: 4,
      unchanged: 'literal',
      count: 3,
    })
  })

  it('omits an unresolved dynamic key and safely resolves missing dynamic values', () => {
    expect(buildUpdatePayload({ '$field': true, value: '$row.$field' }, {}, {}))
      .toEqual({ value: undefined })
    expect(buildUpdatePayload({ value: '!$row.$field' }, {}, {}))
      .toEqual({ value: undefined })
  })

  it('generates an ISO timestamp for $now', () => {
    const result = buildUpdatePayload({ updatedAt: '$now' }, {}, {})

    expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})
