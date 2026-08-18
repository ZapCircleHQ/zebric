import { describe, expect, it, vi } from 'vitest'
import { createRuntimeReadTools, getRuntimeToolMetadata, InMemoryMutationExecutionStateStore, ZebricApiError } from './action-tool-factory.js'
import type { ZebricApplicationContract } from './discovery-client.js'
import { DeterministicAgentDriver } from '../testing/deterministic-driver.js'

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
          'x-zebric-agent-operation': {
            risk: 'external', approvalRequired: true, idempotencyRequired: true,
            asynchronous: true, requiredScopes: ['issues.claim'], workflow: 'ClaimIssue',
            preconditions: { state: 'ready' },
          },
          'x-zebric-required-scopes': ['issues.claim'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: { runId: { type: 'string' } }, required: ['runId'],
          } } } },
        },
      },
    },
  },
}

describe('createRuntimeReadTools', () => {
  it('preserves authoritative operation risk and execution metadata', () => {
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'local', mutations: { approve: () => true },
    })
    const claim = tools.find(tool => tool.name === 'local_issue_board_claim_issue')!
    expect(getRuntimeToolMetadata(claim)).toEqual({
      application: 'local', operationId: 'issue_board_claim_issue', method: 'POST',
      path: '/api/agent/issues/{id}/claim', risk: 'external', approvalRequired: true,
      idempotencyRequired: true, asynchronous: true, requiredScopes: ['issues.claim'],
      workflow: 'ClaimIssue', preconditions: { state: 'ready' },
    })
  })

  it('rejects mutation metadata that claims approval is unnecessary', () => {
    const invalid = structuredClone(contract)
    ;(invalid.openapi.paths['/api/agent/issues/{id}/claim'].post as any)['x-zebric-agent-operation'].approvalRequired = false
    expect(() => createRuntimeReadTools(invalid, {
      applicationName: 'local', mutations: { approve: () => true },
    })).toThrow('mutations must require approval')
  })

  it('rejects contradictory scope and idempotency metadata', () => {
    const invalidScopes = structuredClone(contract)
    ;(invalidScopes.openapi.paths['/api/agent/issues/{id}/claim'].post as any)['x-zebric-required-scopes'] = ['issues.admin']
    expect(() => createRuntimeReadTools(invalidScopes, {
      applicationName: 'local', mutations: { approve: () => true },
    })).toThrow('required scope metadata does not match')

    const invalidIdempotency = structuredClone(contract)
    ;(invalidIdempotency.openapi.paths['/api/agent/issues/{id}/claim'].post as any)['x-zebric-agent-operation'].idempotencyRequired = false
    expect(() => createRuntimeReadTools(invalidIdempotency, {
      applicationName: 'local', mutations: { approve: () => true },
    })).toThrow('idempotencyRequired contradicts the HTTP method')
  })

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

  it('rejects sanitized tool-name collisions', () => {
    const colliding = structuredClone(contract)
    colliding.openapi.paths['/api/collision'] = {
      get: { operationId: 'issue-board-list-columns' },
    }
    expect(() => createRuntimeReadTools(colliding, { applicationName: 'local' }))
      .toThrow('Zebric tool-name collision: local_issue_board_list_columns')
  })

  it.each([
    ['reference', { $ref: '#/components/schemas/Filter' }, 'keyword "$ref"'],
    ['composition', { oneOf: [{ type: 'string' }, { type: 'integer' }] }, 'keyword "oneOf"'],
    ['nullable union', { type: ['string', 'null'] }, 'type unions are not supported'],
    ['nested object', { type: 'object', properties: { value: { type: 'string' } } }, 'keyword "properties"'],
    ['array', { type: 'array', items: { type: 'string' } }, 'keyword "items"'],
    ['unknown type', { type: 'file' }, 'type must be one of'],
    ['unknown format', { type: 'string', format: 'password' }, 'format "password"'],
  ])('rejects unsupported %s parameter schemas with contract diagnostics', (_label, schema, reason) => {
    const unsupportedContract = structuredClone(contract)
    unsupportedContract.openapi.paths['/api/unsupported'] = {
      get: {
        operationId: 'unsupported_schema',
        parameters: [{ name: 'value', in: 'query', schema }],
      },
    }

    const failure = captureFailure(() => createRuntimeReadTools(unsupportedContract, { applicationName: 'local' }))
    expect(failure).toMatchObject({
      application: 'local',
      operationId: 'unsupported_schema',
      schemaPath: 'paths./api/unsupported.get.parameters[0].schema',
    })
    expect(failure.message).toContain(reason)
  })

  it('rejects referenced request bodies rather than dropping their fields', () => {
    const unsupportedContract = structuredClone(contract)
    unsupportedContract.openapi.paths['/api/unsupported'] = {
      post: {
        operationId: 'referenced_body',
        requestBody: { content: { 'application/json': { schema: {
          $ref: '#/components/schemas/Mutation',
        } } } },
      },
    }

    const failure = captureFailure(() => createRuntimeReadTools(unsupportedContract, {
      applicationName: 'local', mutations: { approve: () => true },
    }))
    expect(failure).toMatchObject({
      operationId: 'referenced_body',
      schemaPath: 'paths./api/unsupported.post.requestBody.content.application/json.schema',
    })
    expect(failure.message).toContain('keyword "$ref"')
  })

  it('rejects parameter serialization and path-level parameter features it cannot preserve', () => {
    const serialized = structuredClone(contract)
    serialized.openapi.paths['/api/serialized'] = {
      get: {
        operationId: 'serialized_parameter',
        parameters: [{ name: 'filter', in: 'query', schema: { type: 'string' }, style: 'deepObject' }],
      },
    }
    expect(() => createRuntimeReadTools(serialized, { applicationName: 'local' }))
      .toThrow('parameter keyword "style" is not supported')

    const pathLevel = structuredClone(contract)
    pathLevel.openapi.paths['/api/path-level'] = {
      parameters: [{ name: 'id', in: 'query', schema: { type: 'string' } }],
      get: { operationId: 'path_level_parameter' },
    }
    expect(() => createRuntimeReadTools(pathLevel, { applicationName: 'local' }))
      .toThrow('path-level parameters are not supported')
  })

  it('rejects non-JSON and multi-media request bodies', () => {
    const unsupportedContract = structuredClone(contract)
    unsupportedContract.openapi.paths['/api/media'] = {
      post: {
        operationId: 'multiple_media',
        requestBody: { content: {
          'application/json': { schema: { type: 'object', properties: {} } },
          'text/plain': { schema: { type: 'string' } },
        } },
      },
    }
    expect(() => createRuntimeReadTools(unsupportedContract, {
      applicationName: 'local', mutations: { approve: () => true },
    })).toThrow('only a single application/json media type is supported')
  })

  it('enforces supported numeric constraints before making a request', async () => {
    const fetcher = vi.fn() as typeof fetch
    const constrained = structuredClone(contract)
    constrained.openapi.paths['/api/constrained'] = {
      get: {
        operationId: 'constrained_list',
        parameters: [{
          name: 'limit', in: 'query', required: true,
          schema: { type: 'integer', minimum: 1, maximum: 10 },
        }],
      },
    }
    const tools = createRuntimeReadTools(constrained, { applicationName: 'local', fetch: fetcher })
    const constrainedTool = tools.find(item => item.name === 'local_constrained_list')!

    await expect(constrainedTool.invoke({ limit: 11 })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('parses safe Agent API error envelopes into typed failures', async () => {
    const fetcher = vi.fn(async () => Response.json({
      error: {
        message: 'Issue state changed', code: 'STATE_CONFLICT', requestId: 'req-1',
        retryable: false, details: { currentState: 'testing' },
      },
      ignoredSecret: 'must-not-appear',
    }, { status: 409 })) as typeof fetch
    const tools = createRuntimeReadTools(contract, { applicationName: 'local', fetch: fetcher })

    const failure = await tools[0]!.invoke({}).catch(error => error)
    expect(failure).toBeInstanceOf(ZebricApiError)
    expect(failure).toMatchObject({
      message: 'Issue state changed', status: 409, code: 'STATE_CONFLICT',
      requestId: 'req-1', kind: 'conflict', retryable: false,
      details: { currentState: 'testing' },
    })
    expect(JSON.stringify(failure)).not.toContain('must-not-appear')
  })

  it('redacts the resolved credential from tool results and error messages', async () => {
    const credential = 'credential-that-must-stay-private'
    const successTools = createRuntimeReadTools(contract, {
      applicationName: 'local', credential: () => credential,
      fetch: async () => Response.json({ note: `never return ${credential}` }),
    })
    const output = await successTools[0]!.invoke({})
    expect(String(output)).toContain('[REDACTED]')
    expect(String(output)).not.toContain(credential)

    const failureTools = createRuntimeReadTools(contract, {
      applicationName: 'local', credential: () => credential,
      fetch: async () => Response.json({
        error: { message: `upstream echoed ${credential}`, code: 'BAD_REQUEST' },
      }, { status: 400 }),
    })
    const failure = await failureTools[0]!.invoke({}).catch(error => error)
    expect(failure.message).toContain('[REDACTED]')
    expect(JSON.stringify(failure)).not.toContain(credential)
  })

  it('keeps resolved credentials out of deterministic transcripts', async () => {
    const credential = 'transcript-private-credential'
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'local', credential: () => credential,
      fetch: async () => Response.json({ echoed: credential }),
    })
    const driver = new DeterministicAgentDriver(tools)

    await driver.invoke({ tool: 'local_issue_board_list_columns', input: {} })

    expect(JSON.stringify(driver.transcript)).toContain('[REDACTED]')
    expect(JSON.stringify(driver.transcript)).not.toContain(credential)
  })

  it('approval-gates mutations and supplies an idempotency key', async () => {
    const fetcher = vi.fn(async () => Response.json({ success: true })) as typeof fetch
    const approve = vi.fn(async () => true)
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'local', fetch: fetcher,
      mutations: {
        approve,
        idempotencyKey: (_operation, input) => `claim:${input.id}:${input.runId}`,
        agentRunId: () => 'trusted-agent-run',
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
    expect((init?.headers as Record<string, string>)['x-agent-run-id']).toBe('trusted-agent-run')
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

  it('applies timeout and response-size limits while polling jobs', async () => {
    const fetcher = vi.fn(async (_input, init) => {
      if (fetcher.mock.calls.length === 1) {
        return Response.json({ job: { url: '/api/jobs/job-1' } }, { status: 202 })
      }
      expect(init?.signal).toBeDefined()
      return new Response(JSON.stringify({ status: 'running', padding: 'x'.repeat(300) }))
    }) as typeof fetch
    const tools = createRuntimeReadTools(contract, {
      applicationName: 'local',
      fetch: fetcher,
      maxResponseBytes: 150,
      mutations: {
        approve: () => true,
        idempotencyKey: () => 'claim-1',
        agentRunId: () => 'run-1',
      },
    })
    const claim = tools.find(item => item.name === 'local_issue_board_claim_issue')!

    await expect(claim.invoke({ id: 'issue-1', runId: 'run-1' }))
      .rejects.toThrow('exceeds the configured size limit')
  })

  it('resumes a checkpointed job without resubmitting its mutation', async () => {
    const state = new InMemoryMutationExecutionStateStore()
    const firstFetcher = vi.fn(async (_input, init) => {
      if (init?.method === 'POST') {
        return Response.json({ job: { url: '/api/jobs/job-resume' } }, { status: 202 })
      }
      return Response.json({ id: 'job-resume', status: 'running' })
    }) as typeof fetch
    const mutationOptions = {
      approve: () => true,
      state,
      stateContext: () => 'thread-1',
      agentRunId: () => 'run-1',
      pollIntervalMs: 0,
      maxPolls: 1,
    }
    const firstClaim = createRuntimeReadTools(contract, {
      applicationName: 'local', fetch: firstFetcher, mutations: mutationOptions,
    }).find(item => item.name === 'local_issue_board_claim_issue')!

    await expect(firstClaim.invoke({ id: 'issue-1', runId: 'qa-1' }))
      .rejects.toThrow('Timed out waiting for Zebric workflow job')
    expect(firstFetcher).toHaveBeenCalledTimes(2)

    const resumedFetcher = vi.fn(async (_input, init) => {
      expect(init?.method).toBeUndefined()
      return Response.json({ id: 'job-resume', status: 'succeeded', result: { claimed: true } })
    }) as typeof fetch
    const resumedClaim = createRuntimeReadTools(contract, {
      applicationName: 'local', fetch: resumedFetcher,
      mutations: { ...mutationOptions, agentRunId: () => 'run-2' },
    }).find(item => item.name === 'local_issue_board_claim_issue')!

    const output = await resumedClaim.invoke({ runId: 'qa-1', id: 'issue-1' })
    expect(JSON.parse(String(output))).toMatchObject({ status: 'succeeded' })
    expect(resumedFetcher).toHaveBeenCalledTimes(1)
  })
})

function captureFailure(callback: () => unknown): any {
  try {
    callback()
  } catch (error) {
    return error
  }
  throw new Error('Expected callback to fail')
}
