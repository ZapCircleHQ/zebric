import { describe, expect, it, vi } from 'vitest'
import { createRuntimeReadTools } from './action-tool-factory.js'
import type { ZebricApplicationContract } from './discovery-client.js'

const contract: ZebricApplicationContract = {
  baseUrl: 'https://issues.example',
  openApiUrl: 'https://issues.example/api/openapi.json',
  openapi: {
    openapi: '3.1.0',
    info: { title: 'Issue Board', version: '1.0.0' },
    paths: {
      '/api/agent/columns': {
        get: {
          operationId: 'issue_board_list_columns',
          description: 'List workflow columns.',
          parameters: [{
            name: 'key', in: 'query', required: false,
            schema: { type: 'string', enum: ['ready_to_test'] },
          }],
        },
      },
      '/api/agent/issues/{id}': {
        get: {
          operationId: 'issue_board_get_issue',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
        post: { operationId: 'issue_board_mutate_issue' },
      },
      '/api/agent/issues/{id}/claim': {
        post: {
          operationId: 'issue_board_claim_issue',
          description: 'Claim an issue.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: {
            properties: { runId: { type: 'string' } }, required: ['runId'],
          } } } },
        },
      },
    },
  },
}

describe('createRuntimeReadTools', () => {
  it('creates only GET tools and executes a validated query request', async () => {
    const fetcher = vi.fn(async () => Response.json([{ id: 'column-1' }])) as typeof fetch
    const credential = vi.fn(async () => 'secret-token')
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'local', fetch: fetcher, credential,
    })

    expect(tools.map(item => item.name)).toEqual([
      'local_issue_board_list_columns',
      'local_issue_board_get_issue',
    ])
    await tools[0]!.invoke({ key: 'ready_to_test' })

    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toBe('https://issues.example/api/agent/columns?key=ready_to_test')
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
  })

  it('substitutes and encodes declared path parameters', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: 'issue/1' })) as typeof fetch
    const tools = createRuntimeReadTools(contract, { applicationName: 'local', fetch: fetcher })

    await tools[1]!.invoke({ id: 'issue/1' })

    expect(String(fetcher.mock.calls[0]![0])).toBe('https://issues.example/api/agent/issues/issue%2F1')
  })

  it('rejects invalid enum arguments before making a request', async () => {
    const fetcher = vi.fn() as typeof fetch
    const tools = createRuntimeReadTools(contract, { applicationName: 'local', fetch: fetcher })

    await expect(tools[0]!.invoke({ key: 'done' })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('approval-gates mutations and supplies an idempotency key', async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true })) as typeof fetch
    const approve = vi.fn(async () => true)
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'local', fetch: fetcher,
      mutations: {
        approve,
        idempotencyKey: (_operation, input) => `claim:${input.id}:${input.runId}`,
        observeJobs: false,
      },
    })
    const claim = tools.find(item => item.name === 'local_issue_board_claim_issue')!

    await claim.invoke({ id: 'issue-1', runId: 'run-1' })

    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'issue_board_claim_issue', method: 'POST',
    }))
    const [, init] = fetcher.mock.calls[0]!
    expect((init?.headers as Record<string, string>)['idempotency-key']).toBe('claim:issue-1:run-1')
    expect(init?.body).toBe(JSON.stringify({ runId: 'run-1' }))
  })

  it('does not send a rejected mutation', async () => {
    const fetcher = vi.fn() as typeof fetch
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'local', fetch: fetcher,
      mutations: {
        approve: () => false,
        idempotencyKey: () => 'unused',
      },
    })
    const claim = tools.find(item => item.name === 'local_issue_board_claim_issue')!

    await expect(claim.invoke({ id: 'issue-1', runId: 'run-1' }))
      .rejects.toThrow('not approved')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
