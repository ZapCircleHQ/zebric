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

  it('models the PRD domain without a parallel agent model', () => {
    expect(blueprint.project?.name).toBe('Zebric Dispatch')
    expect(blueprint.entities.map(entity => entity.name)).toEqual(
      expect.arrayContaining(['Request', 'RequestCategory', 'Comment', 'Approval', 'RequestActivity'])
    )
    expect(blueprint.entities.some(entity => entity.name === 'AgentComment')).toBe(false)

    const request = blueprint.entities.find(entity => entity.name === 'Request')
    expect(request?.fields.find(field => field.name === 'status')).toMatchObject({
      values: ['new', 'triaged', 'in_progress', 'waiting', 'completed', 'cancelled'],
    })
    expect(request?.fields.find(field => field.name === 'approvalState')).toBeDefined()
  })

  it('defines the required authenticated product surfaces', () => {
    const inbox = blueprint.pages.find(page => page.path === '/')
    const requests = blueprint.pages.find(page => page.path === '/requests')
    const create = blueprint.pages.find(page => page.path === '/requests/new')
    const detail = blueprint.pages.find(page => page.path === '/requests/:id')
    const categories = blueprint.pages.find(page => page.path === '/admin/categories')

    expect(inbox).toMatchObject({ auth: 'required', layout: 'custom' })
    expect(Object.keys(inbox?.queries || {})).toEqual(['needsApproval', 'assigned', 'waiting', 'recent'])
    expect(requests).toMatchObject({ auth: 'required', layout: 'custom' })
    expect(create?.form).toMatchObject({ entity: 'Request', method: 'create' })
    expect(create?.form?.fields.map((field: any) => field.name)).toEqual([
      'categoryId', 'title', 'description', 'priority',
    ])
    expect(detail).toMatchObject({ auth: 'required', layout: 'custom' })
    expect(Object.keys(detail?.queries || {})).toEqual(['request', 'comments', 'approvals', 'activity'])
    expect(categories?.layout).toBe('list')
  })

  it('guards general, access, and purchasing transitions with workflow preconditions', () => {
    const names = blueprint.workflows?.map(workflow => workflow.name) || []
    expect(names).toEqual(expect.arrayContaining([
      'TriageRequest',
      'StartGeneralWork',
      'RequestHumanApproval',
      'ApproveRequest',
      'RejectRequest',
      'StartProtectedWork',
      'CompleteGeneralRequest',
      'CompleteProtectedRequest',
    ]))

    const completeProtected = blueprint.workflows?.find(workflow => workflow.name === 'CompleteProtectedRequest')
    expect(completeProtected?.transactional).toBe(true)
    expect(completeProtected?.precondition).toMatchObject({
      'variables.data.record.approvalState': 'approved',
      'variables.data.record.status': 'in_progress',
    })

    const detail = blueprint.pages.find(page => page.path === '/requests/:id')
    expect(detail?.actionBar?.actions?.every(action => Boolean(action.visibleWhen))).toBe(true)
  })

  it('exposes a scoped semantic agent surface without approval decisions or raw status writes', () => {
    const dispatch = blueprint.skills?.find(skill => skill.name === 'dispatch')
    const actions = dispatch?.actions || []
    const names = actions.map(action => action.name)

    expect(names).toEqual(expect.arrayContaining([
      'list_requests', 'get_request', 'create_request', 'list_comments',
      'list_approvals', 'list_activity', 'assign_request', 'add_comment',
      'request_approval', 'start_approved_work', 'complete_request',
    ]))
    expect(names).not.toContain('approve_request')
    expect(actions.some(action => action.action === 'update')).toBe(false)
    expect(actions.filter(action => action.method !== 'GET').every(action => action.risk === 'write')).toBe(true)
    expect(blueprint.auth?.apiKeys?.[0]?.scopes).toContain('dispatch.approvals.request')
  })

  it('uses the framework auth and permission model for humans and agents', () => {
    expect(blueprint.auth?.providers).toEqual(['email'])
    expect(Object.keys(blueprint.auth?.permissions || {})).toEqual(
      expect.arrayContaining(['requester', 'operator', 'approver', 'admin', 'user'])
    )
    expect(blueprint.auth?.apiKeys?.[0]).toMatchObject({
      agentId: 'dispatch-operator-agent',
      credentialId: 'dispatch-demo-credential',
    })
  })
})
