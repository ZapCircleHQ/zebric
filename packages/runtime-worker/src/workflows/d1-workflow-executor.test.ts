import { describe, expect, it, vi } from 'vitest'
import { D1WorkflowExecutor } from './d1-workflow-executor.js'

function executor(steps: any[], integrations: any = {}, queries: any = {}) {
  return new D1WorkflowExecutor({ workflows: [{ name: 'General', retries: 1, trigger: { manual: true }, steps }] } as any, { batch: vi.fn() } as any, queries, integrations)
}

describe('general Workers workflows', () => {
  it('preserves typed query results through nested branches, loops, and services', async () => {
    const invoke = vi.fn(async (_service, _operation, params) => params)
    const execute = vi.fn(async () => [{ id: 'one', active: true }, { id: 'two', active: false }])
    const engine = executor([
      { type: 'query', entity: 'Item', action: 'find', assignTo: 'items' },
      { type: 'loop', items: 'variables.items', assignTo: 'results', do: [
        { type: 'condition', if: { 'variables.item.active': true }, then: [
          { type: 'service', service: 'test', operation: 'send', params: { item: '{{variables.item}}', count: '{{variables.data.count}}' }, assignTo: 'sent' },
        ] },
      ] },
    ], { services: { invoke } }, { execute })
    const job = await engine.triggerManual('General', { count: 3 })
    expect(job.status).toBe('completed')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('test', 'send', { item: { id: 'one', active: true }, count: 3 }, expect.any(Object))
    expect(job.result!.results).toHaveLength(2)
  })

  it('stops after an external failure and sanitizes the public job error', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('private credential'))
    const create = vi.fn()
    const engine = executor([
      { type: 'service', service: 'test', operation: 'fail' },
      { type: 'query', entity: 'Item', action: 'create', data: { name: 'later' } },
    ], { services: { invoke } }, { create })
    const job = await engine.triggerManual('General', {})
    expect(job.status).toBe('failed')
    expect(job.error).toBe('Workflow execution failed')
    expect(create).not.toHaveBeenCalled()
  })

  it('accepts transactional intermediate reads', () => {
    expect(() => new D1WorkflowExecutor({ workflows: [{ name: 'Atomic', transactional: true, trigger: { manual: true }, steps: [{ type: 'query', entity: 'Item', action: 'find' }] }] } as any, {} as any, {} as any)).not.toThrow()
  })
  it('dispatches cron and authorized webhooks with system sessions', async () => {
    const invoke = vi.fn(async () => 'ok')
    const workflow = { name: 'Automation', trigger: { schedule: '* * * * *', webhook: '/hook' }, steps: [{ type: 'service', service: 'test', operation: 'send' }] }
    const engine = new D1WorkflowExecutor({ workflows: [workflow] } as any, {} as any, {} as any, { services: { invoke } })
    expect(await engine.triggerSchedule('different')).toEqual([])
    expect((await engine.triggerSchedule('* * * * *'))[0].status).toBe('completed')
    expect(await engine.triggerWebhook('/hook', { headers: {} }, () => false)).toEqual([])
    expect((await engine.triggerWebhook('/hook', { headers: {}, body: { value: 1 } }, () => true))[0].status).toBe('completed')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('preserves the actor and prevents recursive entity-trigger cycles', async () => {
    const create = vi.fn(async (_entity, data) => ({ id: 'created', ...data }))
    const session = { user: { id: 'actor' } } as any
    const engine = new D1WorkflowExecutor({ workflows: [{ name: 'Cascade', trigger: { entity: 'Item', event: 'create' }, steps: [{ type: 'query', entity: 'Item', action: 'create', data: { name: 'child' } }] }] } as any, {} as any, { create } as any)
    const jobs = await engine.triggerEntity('Item', 'create', undefined, { id: 'parent' }, session)
    expect(jobs[0].status).toBe('completed')
    expect(create).toHaveBeenCalledExactlyOnceWith('Item', { name: 'child' }, { session })
    expect(jobs[0].ownerId).toBe('actor')
  })

  it('cancels an inline delay without executing subsequent effects', async () => {
    const create = vi.fn()
    const engine = executor([{ type: 'delay', duration: 60000 }, { type: 'query', entity: 'Item', action: 'create', data: { name: 'later' } }], {}, { create })
    const running = engine.triggerManual('General', {})
    const [job] = await engine.getJobs()
    expect(await engine.cancelJob(job.id)).toBe(true)
    expect((await running).status).toBe('cancelled')
    expect(create).not.toHaveBeenCalled()
  })

  it('times out an uncooperative inline effect and prevents later mutations', async () => {
    const create = vi.fn()
    let finish!: (value: unknown) => void
    const invoke = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const engine = new D1WorkflowExecutor({ workflows: [{ name: 'Timed', trigger: { manual: true }, timeout: 10, steps: [{ type: 'service', service: 'test', operation: 'wait' }, { type: 'query', entity: 'Item', action: 'create', data: { name: 'later' } }] }] } as any, {} as any, { create } as any, { services: { invoke } })
    const job = await engine.triggerManual('Timed', {})
    expect(job.status).toBe('failed')
    expect(job.error).toBe('Workflow execution timed out')
    finish('late result')
    await Promise.resolve()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
  })

  it('retries failed inline jobs from their original inputs', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('failure')).mockResolvedValue('success')
    const engine = executor([{ type: 'service', service: 'test', operation: 'send', assignTo: 'result' }], { services: { invoke } })
    const job = await engine.triggerManual('General', { count: 1 })
    expect(job.status).toBe('failed')
    expect(await engine.retryJob(job.id)).toBe(true)
    expect(await engine.getJob(job.id)).toMatchObject({ status: 'completed', result: { data: { count: 1 }, result: 'success' } })
  })

})
