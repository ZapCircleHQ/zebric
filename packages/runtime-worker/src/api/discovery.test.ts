import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { generateWorkersOpenApi, registerWorkersDiscoveryRoutes } from './discovery.js'

const blueprint: any = {
  version: '0.6.0',
  project: { name: 'Edge API', version: '1.0.0', runtime: { min_version: '0.6.0' } },
  entities: [{
    name: 'Item',
    fields: [
      { name: 'id', type: 'ULID', primary_key: true },
      { name: 'title', type: 'Text', required: true },
    ],
  }],
  pages: [],
  auth: {
    providers: [],
    apiKeys: [{ name: 'agent', keyEnv: 'AGENT_KEY' }],
  },
  skills: [{ name: 'unsupported_worker_skill', actions: [] }],
  commands: [
    { name: 'SupportedCommand', entity: 'Item', mutations: {} },
    { name: 'HandlerCommand', entity: 'Item', handler: './handler.js' },
  ],
}

describe('Workers Agent API discovery', () => {
  it('publishes entity APIs and only the command capabilities Workers can execute', async () => {
    const app = new Hono()
    registerWorkersDiscoveryRoutes(app, blueprint)

    const response = await app.request('https://edge.example/.well-known/zebric-agent.json')
    const discovery = await response.json() as any
    expect(discovery).toMatchObject({
      name: 'Edge API',
      openapi: 'https://edge.example/api/openapi.json',
      authentication: [{ type: 'bearer' }],
      skills: [],
      commands: [{ name: 'SupportedCommand', operationId: 'supported_command', entity: 'Item' }],
      capabilities: {
        entityApi: true,
        workflowJobs: false,
        idempotency: true,
        durableWorkflowEventOutbox: true,
        transactionalWorkflows: true,
        domainCommands: true,
        auditHistory: false,
      },
    })
    expect(discovery.contract.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)

    const openapiResponse = await app.request('https://edge.example/api/openapi.json')
    const openapi = await openapiResponse.json() as any
    expect(openapi.paths['/api/items']).toHaveProperty('get')
    expect(openapi.paths['/api/items']).toHaveProperty('post')
    expect(openapi.paths['/api/items/{id}']).toHaveProperty('put')
    expect(openapi.paths['/api/items/{id}']).toHaveProperty('delete')
    expect(openapi.paths['/api/audit']).toBeUndefined()
    expect(openapi.paths['/api/commands/supported_command/{id}']).toBeDefined()
    expect(openapi.paths['/api/commands/handler_command/{id}']).toBeUndefined()
    expect(openapiResponse.headers.get('etag')).toBe(`"${discovery.contract.fingerprint}"`)
  })

  it('keeps fingerprints independent of request origin', async () => {
    const first = new Hono()
    registerWorkersDiscoveryRoutes(first, blueprint)
    const one = await (await first.request('https://one.example/.well-known/zebric-agent.json')).json() as any
    const two = await (await first.request('https://two.example/.well-known/zebric-agent.json')).json() as any
    expect(one.contract).toEqual(two.contract)
  })

  it('does not require bearer auth when no API keys are configured', () => {
    const spec = generateWorkersOpenApi({ ...blueprint, auth: undefined })
    expect(spec.security).toEqual([])
  })
  it('advertises durable lifecycle support and omits disabled workflow skills', async () => {
    const workflows = [
      { name: 'Active', trigger: { manual: true }, steps: [] },
      { name: 'Disabled', enabled: false, trigger: { manual: true }, steps: [] },
    ]
    const skills = workflows.map(workflow => ({ name: workflow.name, actions: [{ name: 'run', method: 'POST', path: `/api/${workflow.name}`, workflow: workflow.name }] }))
    const app = new Hono()
    registerWorkersDiscoveryRoutes(app, { ...blueprint, workflows, skills }, { durableWorkflows: true })
    const discovery = await (await app.request('https://edge.example/.well-known/zebric-agent.json')).json() as any
    expect(discovery.skills).toEqual(['Active'])
    expect(discovery.capabilities).toMatchObject({ workflowJobs: true, durableWorkflowJobs: true, workflowCancellation: true, workflowRetries: true, d1BatchWorkflows: false })
    const spec = await (await app.request('https://edge.example/api/openapi.json')).json() as any
    expect(spec.paths['/api/Disabled']).toBeUndefined()
    expect(spec.paths['/api/jobs/{id}/cancel'].post).toBeDefined()
    expect(spec.paths['/api/jobs/{id}/retry'].post).toBeDefined()
    expect(spec['x-zebric-workflows'].durable).toBe(true)
  })

})
