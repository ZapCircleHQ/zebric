import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { injectCsrfTokenIntoRequest } from '@zebric/runtime-core'
import type { BlueprintHttpAdapter } from '@zebric/runtime-hono'
import { registerAgentEventStreamRoute, registerAPIRoutes, registerActionRoutes, registerOpenAPIRoute, registerPageRoutes, registerSearchRoutes } from './server-routes.js'
import { createApiKeyRegistry } from './server-security.js'
import { AgentEventBus } from './agent-event-bus.js'

function testApiKeys(scopes: string[], name = 'roadmap-agent') {
  return createApiKeyRegistry([{ token: 'secret-key', credential: {
    name,
    agentId: name,
    credentialId: `${name}-credential`,
    displayName: name,
    scopes,
  } }])
}

describe('agent discovery routes', () => {
  it('publishes application skills and current runtime capabilities', async () => {
    const app = new Hono()
    registerOpenAPIRoute(app, {
      version: '0.1.0',
      project: { name: 'Issue Board', version: '1.0.0', runtime: { min_version: '0.1.0' } },
      entities: [],
      pages: [],
      skills: [{ name: 'issue_board', actions: [] }],
      auth: { providers: ['email'], apiKeys: [{ name: 'agent', keyEnv: 'AGENT_KEY' }] },
    }, { port: 3000 } as any)

    const response = await app.request('http://localhost:3000/.well-known/zebric-agent.json')
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      name: 'Issue Board',
      openapi: 'http://localhost:3000/api/openapi.json',
      contract: { version: '1' },
      authentication: [{ type: 'bearer' }],
      skills: ['issue_board'],
      capabilities: {
        workflowJobs: false,
        idempotency: true,
        eventStream: false,
        transactionalWorkflows: true,
        d1BatchWorkflows: false,
      },
    })
    expect(body.contract.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)

    const openapiResponse = await app.request('http://localhost:3000/api/openapi.json')
    const openapi = await openapiResponse.json() as any
    expect(openapi['x-zebric-contract']).toEqual(body.contract)
    expect(openapiResponse.headers.get('etag')).toBe(`"${body.contract.fingerprint}"`)
  })

  it('keeps the contract fingerprint stable across request origins and changes it with the contract', async () => {
    const blueprint = {
      version: '0.1.0',
      project: { name: 'Stable', version: '1.0.0', runtime: { min_version: '0.1.0' } },
      entities: [], pages: [],
      skills: [{ name: 'status', actions: [{ name: 'read', method: 'GET' as const, path: '/api/status' }] }],
    }
    const first = new Hono()
    registerOpenAPIRoute(first, blueprint, { port: 3000 } as any)
    const firstContract = (await (await first.request('http://one.example/.well-known/zebric-agent.json')).json() as any).contract
    const secondContract = (await (await first.request('http://two.example/.well-known/zebric-agent.json')).json() as any).contract
    expect(firstContract).toEqual(secondContract)

    const changed = new Hono()
    registerOpenAPIRoute(changed, {
      ...blueprint,
      skills: [{ name: 'status', actions: [{ name: 'read_changed', method: 'GET', path: '/api/status' }] }],
    }, { port: 3000 } as any)
    const changedContract = (await (await changed.request('http://one.example/.well-known/zebric-agent.json')).json() as any).contract
    expect(changedContract.fingerprint).not.toBe(firstContract.fingerprint)
  })
})

describe('agent event stream', () => {
  it('requires authentication and streams public event envelopes', async () => {
    const app = new Hono()
    const eventBus = new AgentEventBus()
    registerAgentEventStreamRoute(app, {
      sessionManager: { getSession: async () => null } as any,
      apiKeys: testApiKeys(['entity.item.list']),
      eventBus,
    })

    expect((await app.request('/api/agent/events')).status).toBe(401)
    const response = await app.request('/api/agent/events', {
      headers: { authorization: 'Bearer secret-key' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body!.getReader()
    await reader.read() // connected comment
    const published = eventBus.publish({
      type: 'entity.update',
      subject: 'Item:item-1',
      audienceId: 'roadmap-agent-credential',
      data: { entity: 'Item', action: 'update', id: 'item-1' },
    })
    const frame = new TextDecoder().decode((await reader.read()).value)
    expect(frame).toContain(`id: ${published.id}`)
    expect(frame).toContain('event: entity.update')
    expect(frame).toContain('"id":"item-1"')
    expect(frame).not.toContain('audienceId')
    await reader.cancel()
  })
})

describe('registerPageRoutes', () => {
  it('sets a CSRF cookie when a safe page request generated a token', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      injectCsrfTokenIntoRequest(c.req.raw, 'csrf-from-safe-request')
      await next()
    })
    registerPageRoutes(app, htmlAdapter())

    const response = await app.request('/issues/new')

    expect(response.headers.get('set-cookie')).toContain('csrf-token=csrf-from-safe-request')
  })

  it('does not overwrite an existing CSRF cookie', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      injectCsrfTokenIntoRequest(c.req.raw, 'replacement-token')
      await next()
    })
    registerPageRoutes(app, htmlAdapter())

    const response = await app.request('/issues/new', {
      headers: { cookie: 'csrf-token=existing-token' },
    })

    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('registerAPIRoutes access context', () => {
  const blueprint = {
    version: '0.1.0',
    project: { name: 'API test', version: '0.1.0', runtime: { min_version: '0.1.0' } },
    entities: [{ name: 'Item', fields: [{ name: 'id', type: 'ULID', primary_key: true }] }],
    pages: [],
  } as any

  it('passes cookie sessions to list and item reads', async () => {
    const session = { user: { id: 'user-1', email: 'user@example.com', name: 'User' } }
    const execute = vi.fn(async () => [])
    const findById = vi.fn(async () => ({ id: 'item-1' }))
    const app = new Hono()
    registerAPIRoutes(app, {
      blueprint,
      sessionManager: { getSession: async () => session } as any,
      queryExecutor: { execute, findById } as any,
      apiKeys: new Map(),
    })

    expect((await app.request('/api/items')).status).toBe(200)
    expect((await app.request('/api/items/item-1')).status).toBe(200)
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ entity: 'Item' }), { session })
    expect(findById).toHaveBeenCalledWith('Item', 'item-1', { session })
  })

  it('resolves API keys into sessions for generic entity reads', async () => {
    const execute = vi.fn(async () => [])
    const app = new Hono()
    registerAPIRoutes(app, {
      blueprint,
      sessionManager: { getSession: async () => null } as any,
      queryExecutor: { execute } as any,
      apiKeys: testApiKeys(['entity.item.list']),
    })

    const response = await app.request('/api/items', {
      headers: { authorization: 'Bearer secret-key' },
    })

    expect(response.status).toBe(200)
    expect(execute.mock.calls[0]?.[1]?.session.user.id).toBe('roadmap-agent')
  })

  it('resolves API keys into sessions for generic entity mutations', async () => {
    const create = vi.fn(async () => ({ id: 'item-1' }))
    const app = new Hono()
    registerAPIRoutes(app, {
      blueprint,
      sessionManager: { getSession: async () => null } as any,
      queryExecutor: { create } as any,
      apiKeys: testApiKeys(['entity.item.create']),
    })

    const response = await app.request('/api/items', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-key',
        'content-type': 'application/json',
        'x-agent-run-id': 'entity-create-run',
      },
      body: JSON.stringify({ title: 'Agent item' }),
    })

    expect(response.status).toBe(201)
    expect(create.mock.calls[0]?.[2]?.session.user.id).toBe('roadmap-agent')
  })

  it('prevents API keys from bypassing skills through unscoped entity routes', async () => {
    const app = new Hono()
    registerAPIRoutes(app, {
      blueprint,
      sessionManager: { getSession: async () => null } as any,
      queryExecutor: { delete: vi.fn() } as any,
      apiKeys: testApiKeys(['qa.read'], 'qa-agent'),
    })
    const response = await app.request('/api/items/item-1', {
      method: 'DELETE',
      headers: { authorization: 'Bearer secret-key' },
    })
    expect(response.status).toBe(403)
  })

  it('returns forbidden when query access is denied', async () => {
    const app = new Hono()
    registerAPIRoutes(app, {
      blueprint,
      sessionManager: { getSession: async () => null } as any,
      queryExecutor: { execute: async () => { throw new Error('Access denied: Cannot read Item') } } as any,
      apiKeys: new Map(),
    })

    const response = await app.request('/api/items')
    expect(response.status).toBe(403)
  })
})

describe('registerActionRoutes', () => {
  const session = { user: { id: 'user-1', email: 'user@example.com', name: 'User' } }
  const record = { id: 'item-1', status: 'candidate', title: 'Feature X' }
  const anonymousActionBlueprint = {
    auth: { permissions: { anonymous: { allow: ['*.*'] } } },
    pages: [{
      path: '/roadmap/item-1',
      title: 'Roadmap Item',
      queries: { item: { entity: 'RoadmapItem', where: { id: '$params.id' } } },
      actionBar: {
        actions: [{ label: 'Set status', workflow: 'SetRoadmapStatus' }],
      },
    }],
    workflows: [{ name: 'SetRoadmapStatus', trigger: { manual: true }, steps: [] }],
  }

  function makeApp(overrides: {
    blueprint?: any
    getSession?: () => any
    findById?: () => any
    getWorkflow?: () => any
    trigger?: () => any
  } = {}) {
    const app = new Hono()
    registerActionRoutes(app, {
      blueprint: overrides.blueprint,
      sessionManager: { getSession: overrides.getSession ?? (async () => session) } as any,
      queryExecutor: { findById: overrides.findById ?? vi.fn(async () => record) } as any,
      workflowManager: {
        getWorkflow: overrides.getWorkflow ?? vi.fn(() => ({ name: 'SetRoadmapStatus' })),
        trigger: overrides.trigger ?? vi.fn(() => ({ id: 'job-1', workflowName: 'SetRoadmapStatus' })),
      } as any,
    })
    return app
  }

  it('requires authentication', async () => {
    const trigger = vi.fn()
    const app = makeApp({ getSession: async () => null, trigger })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('does not treat an empty permissions config as anonymous action access', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: { auth: { permissions: {} } },
      getSession: async () => null,
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('requires anonymous action workflows to be exposed on the posted page', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: anonymousActionBlueprint,
      getSession: async () => null,
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('allows anonymous action workflows when blueprint permissions explicitly allow them', async () => {
    const findById = vi.fn(async () => record)
    const trigger = vi.fn(() => ({ id: 'job-1', workflowName: 'SetRoadmapStatus' }))
    const app = makeApp({
      blueprint: anonymousActionBlueprint,
      getSession: async () => null,
      findById,
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1', page: '/roadmap/item-1' }),
    })

    expect(response.status).toBe(200)
    expect(findById).toHaveBeenCalledWith('RoadmapItem', 'item-1', { session: null })
    expect(trigger).toHaveBeenCalledWith(
      'SetRoadmapStatus',
      expect.objectContaining({
        entity: 'RoadmapItem',
        recordId: 'item-1',
        session: null,
      }),
      expect.anything()
    )
  })

  it('rejects anonymous action workflows when the posted entity does not match the page entity', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: anonymousActionBlueprint,
      getSession: async () => null,
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'User', recordId: 'item-1', page: '/roadmap/item-1' }),
    })

    expect(response.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('rejects anonymous action workflows that are not exposed by the page', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: {
        ...anonymousActionBlueprint,
        workflows: [
          ...anonymousActionBlueprint.workflows,
          { name: 'HiddenWorkflow', trigger: { manual: true }, steps: [] },
        ],
      },
      getSession: async () => null,
      trigger,
    })

    const response = await app.request('/actions/HiddenWorkflow', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1', page: '/roadmap/item-1' }),
    })

    expect(response.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('rejects anonymous action workflows that are not manual workflows', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: {
        ...anonymousActionBlueprint,
        pages: [{
          ...anonymousActionBlueprint.pages[0],
          actionBar: {
            actions: [{ label: 'Submit', workflow: 'SubmitItem' }],
          },
        }],
        workflows: [{ name: 'SubmitItem', trigger: { entity: 'RoadmapItem', event: 'create' }, steps: [] }],
      },
      getSession: async () => null,
      trigger,
    })

    const response = await app.request('/actions/SubmitItem', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1', page: '/roadmap/item-1' }),
    })

    expect(response.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('rejects action-bar workflows when the action condition does not match the loaded record', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: {
        pages: [{
          path: '/roadmap/item-1',
          title: 'Roadmap Item',
          queries: { item: { entity: 'RoadmapItem', where: { id: '$params.id' } } },
          actionBar: {
            actions: [{ label: 'Approve', workflow: 'SetRoadmapStatus', enabledWhen: { status: 'approved' } }],
          },
        }],
        workflows: [{ name: 'SetRoadmapStatus', trigger: { manual: true }, steps: [] }],
      },
      findById: async () => ({ ...record, status: 'candidate' }),
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1', page: '/roadmap/item-1' }),
    })

    expect(response.status).toBe(409)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('fails closed when the workflow is gated by enabledWhen but no page is supplied to resolve it', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: {
        pages: [{
          path: '/roadmap/item-1',
          title: 'Roadmap Item',
          queries: { item: { entity: 'RoadmapItem', where: { id: '$params.id' } } },
          actionBar: {
            actions: [{ label: 'Approve', workflow: 'SetRoadmapStatus', enabledWhen: { status: 'approved' } }],
          },
        }],
        workflows: [{ name: 'SetRoadmapStatus', trigger: { manual: true }, steps: [] }],
      },
      // The record actually satisfies the gate - but omitting `page` must still be rejected,
      // since the server can't verify which action-bar entry (if any) authorized this call.
      findById: async () => ({ ...record, status: 'approved' }),
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(409)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('allows the request when any action-bar entry for the workflow matches the record, not just the first one found', async () => {
    const trigger = vi.fn(() => ({ id: 'job-1', workflowName: 'SetRoadmapStatus' }))
    const app = makeApp({
      blueprint: {
        pages: [{
          path: '/roadmap/item-1',
          title: 'Roadmap Item',
          queries: { item: { entity: 'RoadmapItem', where: { id: '$params.id' } } },
          actionBar: {
            actions: [
              { label: 'Approve', workflow: 'SetRoadmapStatus', enabledWhen: { status: 'candidate' } },
              { label: 'Reject', workflow: 'SetRoadmapStatus', enabledWhen: { status: 'approved' } },
            ],
          },
        }],
        workflows: [{ name: 'SetRoadmapStatus', trigger: { manual: true }, steps: [] }],
      },
      findById: async () => ({ ...record, status: 'approved' }),
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1', page: '/roadmap/item-1' }),
    })

    expect(response.status).toBe(200)
    expect(trigger).toHaveBeenCalled()
  })

  it('rejects a precondition written against the removed top-level record/payload keys instead of silently passing', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      getWorkflow: vi.fn(() => ({
        name: 'SetRoadmapStatus',
        // Only resolvable under `variables.data.record.status` in the real trigger
        // context - this top-level path must never spuriously match.
        precondition: { 'record.status': 'candidate' },
      })),
      findById: async () => ({ ...record, status: 'candidate' }),
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(409)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('denies anonymous access when the page has no determinable entity to verify against', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: {
        auth: { permissions: { anonymous: { allow: ['Comment.update'] } } },
        pages: [{
          path: '/trigger',
          title: 'Trigger',
          actionBar: { actions: [{ label: 'Reset', workflow: 'ResetAllPasswords' }] },
        }],
        workflows: [{ name: 'ResetAllPasswords', trigger: { manual: true }, steps: [] }],
      },
      getSession: async () => null,
      trigger,
    })

    const response = await app.request('/actions/ResetAllPasswords', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ page: '/trigger', entity: 'Comment' }),
    })

    expect(response.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('derives the required permission action from the workflow steps instead of assuming update', async () => {
    const trigger = vi.fn(() => ({ id: 'job-1', workflowName: 'SubmitApplication' }))
    const app = makeApp({
      blueprint: {
        auth: { permissions: { anonymous: { allow: ['Application.create'] } } },
        pages: [{
          path: '/apply',
          title: 'Apply',
          queries: { form: { entity: 'Application', where: {} } },
          actionBar: { actions: [{ label: 'Submit', workflow: 'SubmitApplication' }] },
        }],
        workflows: [{ name: 'SubmitApplication', trigger: { manual: true }, steps: [] }],
      },
      getWorkflow: vi.fn(() => ({
        name: 'SubmitApplication',
        trigger: { manual: true },
        steps: [{ type: 'query', entity: 'Application', action: 'create', data: {} }],
      })),
      getSession: async () => null,
      trigger,
    })

    const response = await app.request('/actions/SubmitApplication', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ page: '/apply', entity: 'Application' }),
    })

    expect(response.status).toBe(200)
    expect(trigger).toHaveBeenCalled()
  })

  it('does not let an update-only anonymous rule authorize a workflow whose steps delete records', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: {
        auth: { permissions: { anonymous: { allow: ['RoadmapItem.update'] } } },
        pages: [{
          path: '/roadmap/item-1',
          title: 'Roadmap Item',
          queries: { item: { entity: 'RoadmapItem', where: { id: '$params.id' } } },
          actionBar: { actions: [{ label: 'Delete', workflow: 'DeleteRoadmapItem' }] },
        }],
        workflows: [{ name: 'DeleteRoadmapItem', trigger: { manual: true }, steps: [] }],
      },
      getWorkflow: vi.fn(() => ({
        name: 'DeleteRoadmapItem',
        trigger: { manual: true },
        steps: [{ type: 'query', entity: 'RoadmapItem', action: 'delete', where: {} }],
      })),
      getSession: async () => null,
      trigger,
    })

    const response = await app.request('/actions/DeleteRoadmapItem', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ page: '/roadmap/item-1', entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(401)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('rejects an authenticated caller who can perform the first workflow step but not a later one, before triggering it', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      blueprint: {
        auth: { permissions: { volunteer: { allow: ['RoadmapItem.update'] } } },
      },
      getSession: async () => ({ user: { id: 'user-1', email: 'v@example.com', role: 'volunteer' } }),
      getWorkflow: vi.fn(() => ({
        name: 'SetRoadmapStatus',
        steps: [
          { type: 'query', entity: 'RoadmapItem', action: 'update', where: {}, data: {} },
          { type: 'query', entity: 'ActivityEvent', action: 'create', data: {} },
        ],
      })),
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(403)
    expect(trigger).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.error).toBe('Insufficient permissions for this workflow')
  })

  it('allows an authenticated caller who has permission for every entity/action the workflow steps write', async () => {
    const trigger = vi.fn(() => ({ id: 'job-1', workflowName: 'SetRoadmapStatus' }))
    const app = makeApp({
      blueprint: {
        auth: { permissions: { coordinator: { allow: ['RoadmapItem.update', 'ActivityEvent.create'] } } },
      },
      getSession: async () => ({ user: { id: 'user-1', email: 'c@example.com', role: 'coordinator' } }),
      getWorkflow: vi.fn(() => ({
        name: 'SetRoadmapStatus',
        steps: [
          { type: 'query', entity: 'RoadmapItem', action: 'update', where: {}, data: {} },
          { type: 'query', entity: 'ActivityEvent', action: 'create', data: {} },
        ],
      })),
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(200)
    expect(trigger).toHaveBeenCalled()
  })

  it('rejects workflows when the workflow precondition does not match the loaded record', async () => {
    const trigger = vi.fn()
    const app = makeApp({
      getWorkflow: vi.fn(() => ({
        name: 'SetRoadmapStatus',
        precondition: { 'variables.data.record.status': 'approved' },
      })),
      findById: async () => ({ ...record, status: 'candidate' }),
      trigger,
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ entity: 'RoadmapItem', recordId: 'item-1' }),
    })

    expect(response.status).toBe(409)
    expect(trigger).not.toHaveBeenCalled()
    const body = await response.json()
    expect(body.error).toBe('Workflow precondition failed')
  })

  it('returns 404 when the workflow does not exist', async () => {
    const app = makeApp({ getWorkflow: vi.fn(() => undefined) })

    const response = await app.request('/actions/NoSuchWorkflow', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toContain('NoSuchWorkflow')
  })

  it('loads the record with session context and triggers the workflow on a board card move', async () => {
    const findById = vi.fn(async () => record)
    const trigger = vi.fn(() => ({ id: 'job-1', workflowName: 'SetRoadmapStatus' }))

    const app = makeApp({ findById, trigger })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        entity: 'RoadmapItem',
        recordId: 'item-1',
        payload: JSON.stringify({ status: 'planned' }),
        redirect: '/board',
        successMessage: 'Roadmap status change started.',
      }),
    })

    expect(response.status).toBe(200)
    expect(findById).toHaveBeenCalledWith('RoadmapItem', 'item-1', { session })
    expect(trigger).toHaveBeenCalledWith(
      'SetRoadmapStatus',
      expect.objectContaining({
        record,
        payload: { status: 'planned' },
        entity: 'RoadmapItem',
        recordId: 'item-1',
        session,
      }),
      expect.anything()
    )
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.message).toBe('Roadmap status change started.')
  })

  it('redirects via 303 for form submissions (not JSON accept)', async () => {
    const app = makeApp()

    const params = new URLSearchParams({
      entity: 'RoadmapItem',
      recordId: 'item-1',
      payload: JSON.stringify({ status: 'in_progress' }),
      redirect: '/board',
      successMessage: 'Item moved.',
    })

    const response = await app.request('/actions/SetRoadmapStatus', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      redirect: 'manual',
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/board')
  })
})

describe('registerSearchRoutes', () => {
  it('serves lookup widget search results using blueprint config and session context', async () => {
    const app = new Hono()
    const session = {
      id: 'sess-1',
      userId: 'user-1',
      user: { id: 'user-1', email: 'test@example.com' },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }
    const queryExecutor = {
      search: vi.fn(async () => ([
        { id: 'cus-1', firstName: 'Alice', lastName: 'Smith' },
      ])),
    }
    const sessionManager = {
      getSession: vi.fn(async () => session),
    }

    registerSearchRoutes(app, {
      blueprint: {
        version: '0.3.0',
        project: { name: 'test', version: '1.0.0', runtime: { min_version: '0.2.0' } },
        entities: [],
        pages: [
          {
            path: '/customers',
            title: 'Customer Search',
            widget: {
              kind: 'lookup',
              entity: 'Customer',
              search: ['lastName', 'firstName'],
              display: '{lastName}, {firstName}',
              limit: 5,
              filter: { status: 'active' },
            },
          },
        ],
      } as any,
      queryExecutor: queryExecutor as any,
      sessionManager: sessionManager as any,
    })

    const response = await app.request('/_widget/search?page=/customers&q=alice')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      results: [{ id: 'cus-1', label: 'Smith, Alice' }],
    })
    expect(sessionManager.getSession).toHaveBeenCalledTimes(1)
    expect(queryExecutor.search).toHaveBeenCalledWith(
      'Customer',
      ['lastName', 'firstName'],
      'alice',
      {
        limit: 5,
        filter: { status: 'active' },
        context: { session },
      }
    )
  })
})

function htmlAdapter(): BlueprintHttpAdapter {
  return {
    handle: async () => new Response('<html><body>OK</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
  } as BlueprintHttpAdapter
}
