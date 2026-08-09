import { describe, expect, it, vi } from 'vitest'

const createDeepAgentMock = vi.hoisted(() => vi.fn((options: any) => ({
  invoke: vi.fn(),
  options,
})))
vi.mock('deepagents', () => ({ createDeepAgent: createDeepAgentMock }))
import { createZebricAgent } from './create-zebric-agent.js'

describe('createZebricAgent', () => {
  it('constructs a Deep Agent without invoking the model', async () => {
    const agent = await createZebricAgent({ model: 'openai:test-model' })

    expect(agent).toBeDefined()
    expect(typeof agent.invoke).toBe('function')
  })

  it('discovers configured applications while constructing runtime tools', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/.well-known/zebric-agent.json')) {
        return Response.json({
          name: 'Issue Board',
          openapi: '/api/openapi.json',
          skills: ['issue_board'],
        })
      }
      return Response.json({
        openapi: '3.1.0',
        info: { title: 'Issue Board', version: '1.0.0' },
        paths: {
          '/api/agent/issues': {
            get: { operationId: 'issue_board_list_issues' },
          },
        },
      })
    }

    const agent = await createZebricAgent({
      model: 'openai:test-model',
      applications: [{
        name: 'local',
        baseUrl: 'http://localhost:3000',
        mutations: {
          approve: () => true,
          idempotencyKey: () => 'mutation-1',
          agentRunId: () => 'run-1',
        },
      }],
      fetch: fetcher,
    })

    expect(agent).toBeDefined()
  })

  it('forwards the configured agent run ID into public-factory mutation tools', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/.well-known/zebric-agent.json')) {
        return Response.json({ name: 'App', openapi: '/api/openapi.json' })
      }
      if (url.endsWith('/api/openapi.json')) {
        return Response.json({
          openapi: '3.1.0', info: { title: 'App', version: '1.0.0' },
          paths: { '/api/tasks/{id}/run': { post: {
            operationId: 'run_task',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          } } },
        })
      }
      expect((init?.headers as Record<string, string>)['x-agent-run-id']).toBe('public-run-1')
      return Response.json({ success: true })
    }) as typeof fetch
    await createZebricAgent({
      model: 'openai:test-model', fetch: fetcher,
      applications: [{
        name: 'app', baseUrl: 'https://app.example',
        mutations: {
          approve: () => true,
          idempotencyKey: () => 'run-task-1',
          agentRunId: () => 'public-run-1',
          observeJobs: false,
        },
      }],
    })
    const options = createDeepAgentMock.mock.lastCall?.[0] as any
    const mutationTool = options.tools.find((candidate: any) => candidate.name === 'app_run_task')

    await mutationTool.invoke({ id: 'task-1' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
