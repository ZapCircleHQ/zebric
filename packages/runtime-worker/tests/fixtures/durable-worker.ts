import { createWorkflowEntrypoint } from '../../src/workflows/cloudflare-entrypoint.js'
import { ZebricWorkersEngine, type WorkersEnv } from '../../src/engine.js'

const blueprint = {
  version: '0.6.0',
  project: { name: 'Durable smoke', version: '1.0.0', runtime: { min_version: '0.6.0' } },
  entities: [
    {
      name: 'Item',
      fields: [
        { name: 'id', type: 'Text', primary_key: true },
        { name: 'count', type: 'Integer' }
      ]
    }
  ],
  pages: [],
  workflows: [
    {
      name: 'Durable',
      trigger: { manual: true },
      retries: 2,
      timeout: 5000,
      steps: [
        { type: 'query', entity: 'Item', action: 'create', data: { id: 'only-once', count: 7 }, assignTo: 'record' },
        { type: 'delay', duration: 20 },
        {
          type: 'service',
          service: 'flaky',
          operation: 'send',
          params: { count: '{{variables.record.count}}' },
          assignTo: 'sent'
        }
      ]
    },
    {
      name: 'Slow',
      trigger: { manual: true },
      steps: [
        { type: 'delay', duration: 60000 },
        { type: 'service', service: 'flaky', operation: 'send' }
      ]
    },
    {
      name: 'Recoverable',
      trigger: { manual: true },
      retries: 1,
      steps: [{ type: 'service', service: 'flaky', operation: 'recover', assignTo: 'sent' }]
    }
  ]
} as any

function config(env: WorkersEnv) {
  return {
    blueprint,
    workflowServices: {
      services: {
        invoke: async (_service: string, _operation: string, params: Record<string, unknown>) => {
          if (_operation === 'recover') {
            const result = await env.DB.prepare('UPDATE recovery SET count = count + 1 RETURNING count').first<{
              count: number
            }>()
            if (result!.count === 1) throw new Error('First run fails')
            return { recovered: true }
          }
          const row = await env.DB.prepare('UPDATE attempts SET count = count + 1 RETURNING count').first<{
            count: number
          }>()
          if (row!.count === 1) throw new Error('Transient failure')
          return { count: params.count, attempts: row!.count }
        }
      }
    }
  }
}

export class TestWorkflow extends createWorkflowEntrypoint(config) {}

export default {
  async fetch(request: Request, env: WorkersEnv): Promise<Response> {
    // Construct a fresh engine on every request to exercise shared job ownership.
    const engine = new ZebricWorkersEngine({ ...config(env), env })
    if (new URL(request.url).pathname === '/start') {
      const job = await engine.getWorkflowExecutor().triggerManual(
        new URL(request.url).searchParams.get('workflow') ?? 'Durable',
        {},
        {
          id: 'session',
          userId: 'owner',
          user: { id: 'owner', email: 'owner@example.com' },
          createdAt: new Date(0),
          expiresAt: new Date('2099-01-01')
        }
      )
      return Response.json(job)
    }
    const id = new URL(request.url).searchParams.get('id')!
    if (new URL(request.url).pathname === '/cancel')
      return Response.json({ changed: await engine.getWorkflowExecutor().cancelJob(id) })
    if (new URL(request.url).pathname === '/retry')
      return Response.json({ changed: await engine.getWorkflowExecutor().retryJob(id) })
    return Response.json(await engine.getWorkflowExecutor().getJob(id, 'owner'))
  }
}
