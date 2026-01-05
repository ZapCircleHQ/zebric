import { beforeAll, describe, expect, it } from 'vitest'
import type { Blueprint } from '@zebric/runtime-core'
import { getStory } from './story-registry.js'
import { loadBlueprint } from '../utils/load-blueprint.js'

describe('Story: developer-onboarding', () => {
  const story = getStory('developer-onboarding')
  let blueprint: Blueprint

  beforeAll(async () => {
    blueprint = await loadBlueprint(story.blueprintPath)
  })

  it('loads the onboarding blueprint described in the story registry', () => {
    expect(blueprint.project?.name).toBe('Developer Onboarding')
    expect(blueprint.pages).not.toHaveLength(0)
  })

  it('renders a detail page with an action bar for status changes', () => {
    const detailPage = blueprint.pages.find((page) => page.path.includes('/developers/{id}'))
    expect(detailPage).toBeDefined()
    expect(detailPage?.actionBar?.actions?.length).toBeGreaterThan(0)
    const workflowAction = detailPage?.actionBar?.actions?.find((action) => action.workflow === 'AdvanceDeveloperStatus')
    expect(workflowAction).toBeDefined()
    expect(workflowAction?.payload?.status).toBe('day_one')
  })

  it('defines the manual workflow used by the action bar', () => {
    const workflow = blueprint.workflows?.find((wf) => wf.name === 'AdvanceDeveloperStatus')
    expect(workflow).toBeDefined()
    expect(workflow?.trigger?.manual).toBe(true)
    expect(workflow?.steps[0]?.type).toBe('query')
  })
})
