import { AIMessage } from '@langchain/core/messages'
import { fakeModel } from '@langchain/core/testing'
import { MemorySaver } from '@langchain/langgraph'
import { describe, expect, it, vi } from 'vitest'
import { createZebricAgent } from './create-zebric-agent.js'

describe('createZebricAgent Deep Agents integration', () => {
  it('completes a no-tool prompt through the real graph', async () => {
    const model = fakeModel().respond(new AIMessage('Zebric Agent is ready.'))
    const agent = await createZebricAgent({ model })

    const result = await agent.invoke({
      messages: [{ role: 'user', content: 'Confirm that you are ready.' }],
    }) as { messages: Array<{ content: unknown }> }

    expect(result.messages.at(-1)?.content).toBe('Zebric Agent is ready.')
    expect(model.callCount).toBe(1)
  })

  it('selects and executes a discovered read tool through the real graph', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'local_list_ready_items',
        args: { state: 'ready' },
        id: 'read-ready-items',
      }])
      .respond(new AIMessage('There is one ready item.'))
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/.well-known/zebric-agent.json')) {
        return Response.json({ name: 'Tasks', openapi: '/api/openapi.json' })
      }
      if (url.endsWith('/api/openapi.json')) {
        return Response.json({
          openapi: '3.1.0',
          info: { title: 'Tasks', version: '1.0.0' },
          paths: {
            '/api/agent/items': {
              get: {
                operationId: 'list_ready_items',
                description: 'List items by state.',
                parameters: [{
                  name: 'state', in: 'query', required: true,
                  schema: { type: 'string', enum: ['ready'] },
                }],
              },
            },
          },
        })
      }
      expect(url).toBe('https://tasks.example/api/agent/items?state=ready')
      return Response.json([{ id: 'item-1', state: 'ready' }])
    }) as typeof fetch
    const agent = await createZebricAgent({
      model,
      fetch: fetcher,
      applications: [{ name: 'local', baseUrl: 'https://tasks.example' }],
    })

    const result = await agent.invoke({
      messages: [{ role: 'user', content: 'How many items are ready?' }],
    }) as { messages: Array<{ content: unknown }> }

    expect(result.messages.at(-1)?.content).toBe('There is one ready item.')
    expect(model.callCount).toBe(2)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('interrupts before a mutation and executes it exactly once after approval', async () => {
    const model = fakeModel()
      .respondWithTools([{ name: 'local_complete_item', args: { id: 'item-1' }, id: 'complete-1' }])
      .respond(new AIMessage('The item was completed.'))
    const approve = vi.fn(() => true)
    const fetcher = mutationApplicationFetch()
    const agent = await createZebricAgent({
      model,
      fetch: fetcher,
      checkpointer: new MemorySaver(),
      approval: 'human-in-the-loop',
      applications: [{
        name: 'local',
        baseUrl: 'https://tasks.example',
        mutations: { approve, observeJobs: false },
      }],
    })

    const interrupted = await agent.invoke({
      messages: [{ role: 'user', content: 'Complete item one.' }],
    }, { threadId: 'approval-thread' }) as { __interrupt__?: unknown[] }

    expect(interrupted.__interrupt__).toHaveLength(1)
    expect(approve).not.toHaveBeenCalled()
    expect(mutationRequests(fetcher)).toHaveLength(0)

    const resumed = await agent.resume('approval-thread', { type: 'approve' }) as {
      messages: Array<{ content: unknown }>
    }

    expect(resumed.messages.at(-1)?.content).toBe('The item was completed.')
    expect(approve).toHaveBeenCalledTimes(1)
    expect(mutationRequests(fetcher)).toHaveLength(1)
  })

  it('does not execute a mutation rejected at the approval boundary', async () => {
    const model = fakeModel()
      .respondWithTools([{ name: 'local_complete_item', args: { id: 'item-1' }, id: 'complete-2' }])
      .respond(new AIMessage('The mutation was not performed.'))
    const approve = vi.fn(() => true)
    const fetcher = mutationApplicationFetch()
    const agent = await createZebricAgent({
      model,
      fetch: fetcher,
      checkpointer: new MemorySaver(),
      approval: 'human-in-the-loop',
      applications: [{
        name: 'local', baseUrl: 'https://tasks.example',
        mutations: { approve, observeJobs: false },
      }],
    })

    await agent.invoke({
      messages: [{ role: 'user', content: 'Complete item one.' }],
    }, { threadId: 'rejection-thread' })
    const resumed = await agent.resume('rejection-thread', {
      type: 'reject', message: 'Do not change this item.',
    }) as { messages: Array<{ content: unknown }> }

    expect(resumed.messages.at(-1)?.content).toBe('The mutation was not performed.')
    expect(approve).not.toHaveBeenCalled()
    expect(mutationRequests(fetcher)).toHaveLength(0)
    await expect(agent.resume('rejection-thread', { type: 'approve' }))
      .rejects.toThrow('No interrupted Zebric Agent run exists')
  })
})

function mutationApplicationFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/.well-known/zebric-agent.json')) {
      return Response.json({ name: 'Tasks', openapi: '/api/openapi.json' })
    }
    if (url.endsWith('/api/openapi.json')) {
      return Response.json({
        openapi: '3.1.0', info: { title: 'Tasks', version: '1.0.0' },
        paths: {
          '/api/agent/items/{id}/complete': {
            post: {
              operationId: 'complete_item',
              parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            },
          },
        },
      })
    }
    expect(init?.method).toBe('POST')
    return Response.json({ success: true })
  }) as ReturnType<typeof vi.fn<typeof fetch>>
}

function mutationRequests(fetcher: ReturnType<typeof mutationApplicationFetch>) {
  return fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
}
