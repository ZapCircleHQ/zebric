import { beforeAll, describe, expect, it } from 'vitest'
import type { Blueprint } from '@zebric/runtime-core'
import { getStory } from './story-registry.js'
import { loadBlueprint } from '../utils/load-blueprint.js'

describe('Story: task-tracker-kanban', () => {
  const story = getStory('task-tracker-kanban')
  let blueprint: Blueprint

  beforeAll(async () => {
    blueprint = await loadBlueprint(story.blueprintPath)
  })

  it('defines the Task entity with status and priority enums', () => {
    const task = blueprint.entities?.find((entity) => entity.name === 'Task')
    expect(task).toBeDefined()
    const statusField = task?.fields.find((field: any) => field.name === 'status')
    expect(statusField?.type).toBe('Enum')
    expect(statusField?.values).toEqual(['not_started', 'in_progress', 'done'])
  })

  it('renders the home page as a board widget grouped by status', () => {
    const home = blueprint.pages.find((page) => page.path === '/')
    expect(home?.widget?.kind).toBe('board')
    expect(home?.widget?.entity).toBe('Task')
    expect(home?.widget?.group_by).toBe('status')
    expect(home?.widget?.columns?.map((column) => column.value)).toEqual([
      'not_started',
      'in_progress',
      'done',
    ])
  })

  it('maps a card move to a status + rank update', () => {
    const home = blueprint.pages.find((page) => page.path === '/')
    expect(home?.widget?.on_move?.update).toMatchObject({
      status: '$to.id',
      position: '$index',
    })
  })

  it('provides a task creation form that redirects home with a success message', () => {
    const formPage = blueprint.pages.find((page) => page.path === '/tasks/new')
    expect(formPage?.form?.entity).toBe('Task')
    expect(formPage?.form?.onSuccess?.redirect).toBe('/')
    expect(formPage?.form?.onSuccess?.message).toContain('Task created')
  })
})
