import { describe, expect, it, vi } from 'vitest'
import { handleWidgetEvent } from './handler.js'
import type { Blueprint } from '../types/blueprint.js'

const request = { method: 'POST', url: '/_zebric/widget-event', headers: {} }

function blueprint(): Blueprint {
  return {
    version: '1',
    project: { name: 'test', version: '1', runtime: { min_version: '1' } },
    entities: [],
    pages: [{
      path: '/tasks',
      title: 'Tasks',
      widget: {
        kind: 'board',
        on_toggle: {
          update: { '$field': '!$row.$field' },
          workflow: 'task-toggled',
        },
      } as any,
    }],
  }
}

function queryExecutor(overrides: Record<string, any> = {}) {
  return {
    execute: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({ id: 'task-1', completed: true }),
    delete: vi.fn(),
    findById: vi.fn().mockResolvedValue({ id: 'task-1', completed: false }),
    search: vi.fn(),
    ...overrides,
  }
}

const validBody = {
  page: '/tasks',
  event: 'toggle',
  row: { entity: 'Task', id: 'task-1' },
  ctx: { field: 'completed' },
}

describe('handleWidgetEvent', () => {
  it.each([
    null,
    {},
    { ...validBody, page: 1 },
    { ...validBody, event: null },
    { ...validBody, row: null },
    { ...validBody, row: { entity: 1, id: 'task-1' } },
    { ...validBody, row: { entity: 'Task', id: 1 } },
  ])('rejects an invalid event body', async (body) => {
    const result = await handleWidgetEvent(blueprint(), body, request, {
      queryExecutor: queryExecutor(),
    })

    expect(result).toEqual({ status: 400, body: { error: 'Invalid widget event' } })
  })

  it('loads the session and current row, updates the entity, and triggers a workflow', async () => {
    const executor = queryExecutor()
    const session = { user: { id: 'user-1', email: 'user@example.test' } } as any
    const getSession = vi.fn().mockResolvedValue(session)
    const triggerWorkflow = vi.fn()

    const result = await handleWidgetEvent(blueprint(), validBody, request, {
      queryExecutor: executor,
      sessionManager: { getSession },
      triggerWorkflow,
    })

    expect(getSession).toHaveBeenCalledWith(request)
    expect(executor.findById).toHaveBeenCalledWith('Task', 'task-1')
    expect(executor.update).toHaveBeenCalledWith(
      'Task', 'task-1', { completed: true }, { session },
    )
    expect(triggerWorkflow).toHaveBeenCalledWith('task-toggled', {
      row: { id: 'task-1', completed: true },
      ctx: { field: 'completed' },
      session,
    })
    expect(result).toEqual({
      status: 200,
      body: { success: true, record: { id: 'task-1', completed: true } },
    })
  })

  it('tolerates a current-row lookup failure', async () => {
    const executor = queryExecutor({ findById: vi.fn().mockRejectedValue(new Error('missing')) })

    const result = await handleWidgetEvent(blueprint(), validBody, request, {
      queryExecutor: executor,
    })

    expect(executor.update).toHaveBeenCalledWith(
      'Task', 'task-1', { completed: true }, { session: null },
    )
    expect(result.status).toBe(200)
  })

  it('rejects an event that is not configured by the page widget', async () => {
    const executor = queryExecutor()

    const result = await handleWidgetEvent(
      blueprint(), { ...validBody, event: 'move' }, request, { queryExecutor: executor },
    )

    expect(result).toEqual({
      status: 400,
      body: { error: 'Unknown widget event: move' },
    })
    expect(executor.update).not.toHaveBeenCalled()
  })

  it('logs and ignores synchronous workflow trigger failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const executor = queryExecutor()
    const error = new Error('workflow unavailable')

    const result = await handleWidgetEvent(blueprint(), validBody, request, {
      queryExecutor: executor,
      triggerWorkflow: () => { throw error },
    })

    expect(result.status).toBe(200)
    expect(warn).toHaveBeenCalledWith(
      "widget event: workflow 'task-toggled' trigger failed",
      error,
    )
    warn.mockRestore()
  })
})
