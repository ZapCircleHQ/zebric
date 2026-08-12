import { describe, expect, it, vi } from 'vitest'

const graphInvokeMock = vi.hoisted(() => vi.fn())
const createDeepAgentMock = vi.hoisted(() => vi.fn((options: any) => ({
  invoke: graphInvokeMock,
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

  it('rejects invalid configuration before discovery or model invocation', async () => {
    const fetcher = vi.fn() as typeof fetch
    await expect(createZebricAgent({
      model: 'openai:test-model',
      applications: [
        { name: 'same', baseUrl: 'https://one.example' },
        { name: 'SAME', baseUrl: 'https://two.example' },
      ],
      fetch: fetcher,
    })).rejects.toThrow('Duplicate Zebric application name')
    expect(fetcher).not.toHaveBeenCalled()
    expect(graphInvokeMock).not.toHaveBeenCalled()
  })

  it('rejects tool-name collisions across connected applications', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/.well-known/zebric-agent.json')) {
        return Response.json({ name: 'App', openapi: '/api/openapi.json' })
      }
      return Response.json({
        openapi: '3.1.0', info: { title: 'App', version: '1.0.0' },
        paths: { '/api/items': { get: { operationId: 'list_items' } } },
      })
    }
    await expect(createZebricAgent({
      model: 'openai:test-model', fetch: fetcher,
      applications: [
        { name: 'a-b', baseUrl: 'https://one.example' },
        { name: 'a_b', baseUrl: 'https://two.example' },
      ],
    })).rejects.toThrow('Zebric tool-name collision: a_b_list_items')
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

  it('generates isolated run and correlation IDs for each top-level invocation', async () => {
    const headers: Array<Record<string, string>> = []
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
      headers.push(init?.headers as Record<string, string>)
      return Response.json({ success: true })
    }) as typeof fetch
    const agent = await createZebricAgent({
      model: 'openai:test-model', fetch: fetcher,
      applications: [{
        name: 'app', baseUrl: 'https://app.example',
        mutations: {
          approve: () => true,
          idempotencyKey: () => 'run-task',
          observeJobs: false,
        },
      }],
    })
    const mutationTool = (createDeepAgentMock.mock.lastCall?.[0] as any).tools
      .find((candidate: any) => candidate.name === 'app_run_task')
    graphInvokeMock.mockImplementationOnce(() => mutationTool.invoke({ id: 'one' }))
    graphInvokeMock.mockImplementationOnce(() => mutationTool.invoke({ id: 'two' }))

    await agent.invoke({ messages: [] }, { threadId: 'thread-1' })
    await agent.invoke({ messages: [] }, { threadId: 'thread-1' })

    expect(headers).toHaveLength(2)
    expect(headers[0]?.['x-agent-run-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(headers[0]?.['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(headers[1]?.['x-agent-run-id']).not.toBe(headers[0]?.['x-agent-run-id'])
    expect(headers[1]?.['x-correlation-id']).not.toBe(headers[0]?.['x-correlation-id'])
    expect(graphInvokeMock.mock.calls.at(-1)?.[1]).toEqual({
      configurable: { thread_id: 'thread-1' },
    })
  })
})
