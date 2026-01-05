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

  it('includes a dashboard page with custom behaviors for rendering and status clicks', () => {
    const dashboard = blueprint.pages.find((page) => page.path === '/dashboard')
    expect(dashboard?.layout).toBe('custom')
    expect(dashboard?.behavior?.render).toBe('./behaviors/dashboard-render.js')
    expect(dashboard?.behavior?.on_status_click).toBe('./behaviors/status-click.js')
  })

  it('provides a task creation form that redirects home with a success message', () => {
    const formPage = blueprint.pages.find((page) => page.path === '/tasks/new')
    expect(formPage?.form?.entity).toBe('Task')
    expect(formPage?.form?.onSuccess?.redirect).toBe('/')
    expect(formPage?.form?.onSuccess?.message).toContain('Task created')
  })
})
