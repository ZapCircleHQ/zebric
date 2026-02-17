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

  it('defines dashboard and issue list pages for dispatch operations', () => {
    expect(blueprint.project?.name).toBe('Zebric Dispatch')

    const dashboard = blueprint.pages.find((page) => page.path === '/')
    const issues = blueprint.pages.find((page) => page.path === '/issues')
    const board = blueprint.pages.find((page) => page.path === '/board')

    expect(dashboard?.layout).toBe('dashboard')
    expect(Object.keys(dashboard?.queries || {})).toEqual(['summaryNew', 'summaryAwaitingApproval'])
    expect(issues?.layout).toBe('list')
    expect(board?.layout).toBe('dashboard')
  })

  it('provides an issue intake form with object-based select options and redirect', () => {
    const intakePage = blueprint.pages.find((page) => page.path === '/issues/new')
    expect(intakePage?.layout).toBe('form')
    expect(intakePage?.form?.entity).toBe('Issue')
    expect(intakePage?.form?.method).toBe('create')

    const categoryField = intakePage?.form?.fields.find((field: any) => field.name === 'category')
    expect(categoryField?.type).toBe('select')
    expect(categoryField?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'general', label: 'General' }),
        expect.objectContaining({ value: 'finance', label: 'Finance' })
      ])
    )

    expect(intakePage?.form?.onSuccess?.redirect).toBe('/issues/{id}')
  })

  it('wires issue detail actions to manual lifecycle workflows', () => {
    const detailPage = blueprint.pages.find((page) => page.path === '/issues/:id')
    expect(detailPage?.layout).toBe('detail')
    expect(detailPage?.actionBar?.actions?.some((action) => action.workflow === 'SetIssueStatus')).toBe(true)
    expect(detailPage?.actionBar?.actions?.some((action) => action.workflow === 'RequestApprovalIfNeeded')).toBe(true)

    const statusWorkflow = blueprint.workflows?.find((workflow) => workflow.name === 'SetIssueStatus')
    const approvalWorkflow = blueprint.workflows?.find((workflow) => workflow.name === 'RequestApprovalIfNeeded')

    expect(statusWorkflow?.trigger?.manual).toBe(true)
    expect(approvalWorkflow?.trigger?.manual).toBe(true)
  })

  it('configures Slack notifications for done issue transitions', () => {
    expect(blueprint.notifications?.adapters.some((adapter) => adapter.name === 'slack_dispatch' && adapter.type === 'slack')).toBe(true)
    const slackAdapter = blueprint.notifications?.adapters.find((adapter) => adapter.name === 'slack_dispatch')
    expect((slackAdapter as any)?.config?.botTokenEnv).toBe('SLACK_BOT_TOKEN')

    const notifyWorkflow = blueprint.workflows?.find((workflow) => workflow.name === 'NotifyDoneToSlack')
    expect(notifyWorkflow).toBeDefined()
    expect(notifyWorkflow?.trigger?.entity).toBe('Issue')
    expect(notifyWorkflow?.trigger?.event).toBe('update')
    expect(notifyWorkflow?.trigger?.condition).toEqual({
      'after.status': 'done',
      'before.status': { $ne: 'done' }
    })
    expect(notifyWorkflow?.steps[0]?.type).toBe('notify')
    expect((notifyWorkflow?.steps[0] as any)?.adapter).toBe('slack_dispatch')
    expect((notifyWorkflow?.steps[0] as any)?.metadata).toEqual(
      expect.objectContaining({ mrkdwn: true })
    )
  })
})
