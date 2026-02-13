import { beforeAll, describe, expect, it } from 'vitest'
import type { Blueprint } from '@zebric/runtime-core'
import { getStory } from './story-registry.js'
import { loadBlueprint } from '../utils/load-blueprint.js'

describe('Story: zebric-dispatch', () => {
  const story = getStory('zebric-dispatch')
  let blueprint: Blueprint

  beforeAll(async () => {
    blueprint = await loadBlueprint(story.blueprintPath)
  })

  it('defines dashboard and queue pages for dispatch operations', () => {
    expect(blueprint.project?.name).toBe('Zebric Dispatch')

    const dashboard = blueprint.pages.find((page) => page.path === '/')
    const inbox = blueprint.pages.find((page) => page.path === '/inbox')
    const triage = blueprint.pages.find((page) => page.path === '/triage')

    expect(dashboard?.layout).toBe('dashboard')
    expect(Object.keys(dashboard?.queries || {})).toEqual(['hotRequests', 'blockedRequests', 'roadmapCandidates'])
    expect(inbox?.layout).toBe('list')
    expect(triage?.layout).toBe('list')
  })

  it('provides a request intake form with object-based select options and redirect', () => {
    const intakePage = blueprint.pages.find((page) => page.path === '/requests/new')
    expect(intakePage?.layout).toBe('form')
    expect(intakePage?.form?.entity).toBe('Request')
    expect(intakePage?.form?.method).toBe('create')

    const sourceField = intakePage?.form?.fields.find((field: any) => field.name === 'source')
    expect(sourceField?.type).toBe('select')
    expect(sourceField?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'slack', label: 'Slack' }),
        expect.objectContaining({ value: 'github', label: 'GitHub' })
      ])
    )

    expect(intakePage?.form?.onSuccess?.redirect).toBe('/requests/{id}')
  })

  it('wires request detail actions to manual lifecycle workflows', () => {
    const detailPage = blueprint.pages.find((page) => page.path === '/requests/:id')
    expect(detailPage?.layout).toBe('detail')
    expect(detailPage?.actionBar?.actions?.some((action) => action.workflow === 'SetRequestStatus')).toBe(true)
    expect(detailPage?.actionBar?.secondaryActions?.some((action) => action.workflow === 'SetQuarterBucket')).toBe(true)

    const statusWorkflow = blueprint.workflows?.find((workflow) => workflow.name === 'SetRequestStatus')
    const bucketWorkflow = blueprint.workflows?.find((workflow) => workflow.name === 'SetQuarterBucket')

    expect(statusWorkflow?.trigger?.manual).toBe(true)
    expect(bucketWorkflow?.trigger?.manual).toBe(true)
  })
})
