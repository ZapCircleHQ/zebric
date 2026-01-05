import { beforeAll, describe, expect, it } from 'vitest'
import type { Blueprint } from '@zebric/runtime-core'
import { getStory } from './story-registry.js'
import { loadBlueprint } from '../utils/load-blueprint.js'

describe('Story: feature-pipeline', () => {
  const story = getStory('feature-pipeline')
  let blueprint: Blueprint

  beforeAll(async () => {
    blueprint = await loadBlueprint(story.blueprintPath)
  })

  it('includes the expected entities for customers and feature tracking', () => {
    const entities = blueprint.entities?.map((entity) => entity.name)
    expect(entities).toContain('ChatSession')
    expect(entities).toContain('ChatMessage')
  })

  it('defines the chat experience page described in the story', () => {
    const detailPage = blueprint.pages.find((page) => page.path === '/sessions/:id')
    expect(detailPage?.layout).toBe('custom')
    expect(detailPage?.behavior?.render).toContain('behaviors/chat-render.js')
  })

  it('registers the OpenAI workflow for blueprint generation', () => {
    const workflow = blueprint.workflows?.find((wf) => wf.name === 'generate_vibe_blueprint')
    expect(workflow).toBeDefined()
    expect(workflow?.steps.some((step) => step.type === 'webhook')).toBe(true)
  })
})
