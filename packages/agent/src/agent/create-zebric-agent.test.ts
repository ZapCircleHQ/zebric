import { describe, expect, it } from 'vitest'
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
      applications: [{ name: 'local', baseUrl: 'http://localhost:3000' }],
      fetch: fetcher,
    })

    expect(agent).toBeDefined()
  })
})
