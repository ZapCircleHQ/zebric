import { describe, expect, it, vi } from 'vitest'
import { ZebricWorkersEngine } from '../engine.js'
import { MockD1Database } from '../test-helpers/mocks.js'

function environment() {
  const states = new Map<string, any>()
  const binding = {
    create: vi.fn(async ({ id }: any) => {
      if (states.has(id)) throw new Error('Duplicate instance')
      states.set(id, { status: 'queued' })
      return { id }
    }),
    get: vi.fn(async (id: string) => ({
      status: async () => states.get(id) ?? { status: 'unknown' },
      terminate: async () => {
        states.set(id, { status: 'terminated' })
      },
      restart: async () => {
        states.set(id, { status: 'queued' })
      }
    }))
  }
  const blueprint: any = {
    version: '0.6.0',
    project: { name: 'Durable API', version: '1.0.0', runtime: { min_version: '0.6.0' } },
    entities: [],
    pages: [],
    workflows: [{ name: 'Run', trigger: { manual: true }, steps: [] }],
    skills: [
      {
        name: 'jobs',
        auth: 'required',
        actions: [{ name: 'run', method: 'POST', path: '/api/run', workflow: 'Run', scopes: ['workflow.run'] }]
      }
    ],
    auth: {
      providers: [],
      apiKeys: [
        { name: 'owner', keyEnv: 'OWNER_KEY', scopes: ['workflow.run'] },
        { name: 'other', keyEnv: 'OTHER_KEY', scopes: ['workflow.run'] }
      ]
    }
  }
  const env = {
    DB: new MockD1Database(),
    WORKFLOWS: binding,
    OWNER_KEY: 'owner-secret',
    OTHER_KEY: 'other-secret'
  } as any
  const engine = () =>
    new ZebricWorkersEngine({
      env,
      blueprint,
      authProvider: {
        getAuthInstance: () => ({ handler: () => new Response(null, { status: 204 }) }),
        getSession: async () => null,
        hasRole: () => false,
        ownsResource: () => false
      }
    })
  const request = (path: string, key = 'owner-secret', body?: string, extra: Record<string, string> = {}) =>
    new Request(`https://edge.example${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'x-agent-run-id': 'run-1',
        ...extra
      },
      body
    })
  return { engine, request, states, binding }
}

describe('durable workflow HTTP lifecycle', () => {
  it('authorizes polling and lifecycle controls across fresh engines', async () => {
    const { engine, request, states, binding } = environment()
    const response = await engine().fetch(request('/api/run', 'owner-secret', '{}'))
    expect(response.status).toBe(202)
    const { job } = (await response.json()) as any
    expect(job.status).toBe('pending')
    expect((await engine().fetch(request(job.url))).status).toBe(200)
    binding.get.mockClear()
    expect((await engine().fetch(request(job.url, 'other-secret'))).status).toBe(404)
    expect(binding.get).not.toHaveBeenCalled()
    expect((await engine().fetch(request(`${job.url}/cancel`, 'other-secret', '{}'))).status).toBe(404)
    expect(
      (await engine().fetch(request(`${job.url}/cancel`, 'owner-secret', '{}', { 'x-agent-run-id': 'invalid run' })))
        .status
    ).toBe(400)
    expect((await engine().fetch(request(`${job.url}/cancel`, 'owner-secret', '{}'))).status).toBe(200)
    expect(states.get(job.id).status).toBe('terminated')
    expect((await engine().fetch(request(`${job.url}/retry`, 'owner-secret', '{}'))).status).toBe(409)
    states.set(job.id, { status: 'errored' })
    expect((await engine().fetch(request(`${job.url}/retry`, 'owner-secret', '{}'))).status).toBe(200)
    expect(states.get(job.id).status).toBe('queued')
  })

  it('replays one job across isolates and rejects conflicting durable input', async () => {
    const { engine, request, states } = environment()
    const send = (body: string) =>
      engine().fetch(request('/api/run', 'owner-secret', body, { 'idempotency-key': 'key-1' }))
    const results = await Promise.all([send('{"value":1}'), send('{"value":1}')])
    expect(results.map((response) => response.status)).toEqual([202, 202])
    const bodies = (await Promise.all(results.map((response) => response.json()))) as any[]
    expect(bodies[0].job.id).toBe(bodies[1].job.id)
    expect(states.size).toBe(1)
    const conflict = await send('{"value":2}')
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSE' } })
  })
})
