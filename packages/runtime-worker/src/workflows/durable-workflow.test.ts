import { describe, expect, it, vi } from 'vitest'
import { D1Adapter } from '../database/d1-adapter.js'
import { MockD1Database } from '../test-helpers/mocks.js'
import { D1WorkflowExecutor } from './d1-workflow-executor.js'
import type { DurableWorkflowPayload, DurableWorkflowStep } from './durable-workflow.js'

const session = {
  id: 'session',
  userId: 'owner',
  user: { id: 'owner', email: 'owner@example.com' },
  createdAt: new Date(0),
  expiresAt: new Date('2099-01-01')
}

function backend() {
  const instances = new Map<string, { payload: DurableWorkflowPayload; state: any }>()
  const create = vi.fn(async ({ id, params }) => {
    if (instances.has(id)) throw new Error('Instance already exists')
    instances.set(id, { payload: structuredClone(params), state: { status: 'queued' } })
    return { id }
  })
  const terminate = vi.fn(async (id: string) => {
    instances.get(id)!.state = { status: 'terminated' }
  })
  const restart = vi.fn(async (id: string) => {
    instances.get(id)!.state = { status: 'queued' }
  })
  const binding = {
    create,
    get: vi.fn(async (id: string) => ({
      status: async () => instances.get(id)?.state ?? { status: 'unknown' },
      terminate: () => terminate(id),
      restart: () => restart(id)
    }))
  } as any
  return { binding, instances, create, terminate, restart }
}

function checkpoints() {
  const completed = new Map<string, unknown>()
  const step: DurableWorkflowStep = {
    do: vi.fn(async (name, _config, callback) => {
      if (!completed.has(name)) completed.set(name, structuredClone(await callback()))
      return structuredClone(completed.get(name)) as any
    }),
    sleep: vi.fn(async () => {})
  }
  return step
}

describe('durable Workers workflows', () => {
  it('queues before executing and authorizes shared job metadata before querying the provider', async () => {
    const db = new D1Adapter(new MockD1Database() as any)
    const provider = backend()
    const blueprint = { workflows: [{ name: 'General', trigger: { manual: true }, steps: [] }] } as any
    const first = new D1WorkflowExecutor(blueprint, db, {} as any, {}, provider.binding)
    const second = new D1WorkflowExecutor(blueprint, db, {} as any, {}, provider.binding)
    const queued = await first.triggerManual('General', { privateInput: 'private' }, session)
    expect(queued.status).toBe('pending')
    provider.binding.get.mockClear()
    expect(await second.getJob(queued.id, 'other')).toBeUndefined()
    expect(provider.binding.get).not.toHaveBeenCalled()
    provider.instances.get(queued.id)!.state = { status: 'complete', output: { done: true } }
    expect(await second.getJob(queued.id, 'owner')).toMatchObject({
      ownerId: 'owner',
      status: 'completed',
      result: { done: true }
    })
  })

  it('deduplicates concurrent submissions across isolates and rejects conflicting input', async () => {
    const db = new D1Adapter(new MockD1Database() as any)
    const provider = backend()
    const blueprint = { workflows: [{ name: 'General', trigger: { manual: true }, steps: [] }] } as any
    const first = new D1WorkflowExecutor(blueprint, db, {} as any, {}, provider.binding)
    const second = new D1WorkflowExecutor(blueprint, db, {} as any, {}, provider.binding)
    const submission = { scope: 'owner:key', fingerprint: 'same' }
    const jobs = await Promise.all(
      [first, second].map((engine) => engine.triggerManual('General', { value: 1 }, session, submission))
    )
    expect(jobs[0].id).toBe(jobs[1].id)
    expect(provider.instances.size).toBe(1)
    await expect(
      second.triggerManual('General', { value: 2 }, session, { ...submission, fingerprint: 'different' })
    ).rejects.toThrow('Idempotency key')
  })

  it('restores completed mutations and typed assignments when a later step replays', async () => {
    const create = vi.fn(async () => ({ id: 'created', count: 7 }))
    const invoke = vi.fn().mockRejectedValueOnce(new Error('retry me')).mockResolvedValue({ sent: true })
    const workflow = {
      name: 'General',
      trigger: { manual: true },
      retries: 2,
      timeout: 1234,
      steps: [
        { type: 'query', entity: 'Item', action: 'create', data: { count: 7 }, assignTo: 'record' },
        { type: 'delay', duration: 60000 },
        {
          type: 'condition',
          if: { 'variables.record.count': 7 },
          then: [
            {
              type: 'service',
              service: 'test',
              operation: 'send',
              params: { record: '{{variables.record}}' },
              assignTo: 'sent'
            }
          ]
        }
      ]
    } as any
    const engine = new D1WorkflowExecutor({ workflows: [workflow] } as any, {} as any, { create } as any, {
      services: { invoke }
    })
    const payload = {
      job: { id: 'job', workflowName: 'General', createdAt: new Date().toISOString(), status: 'pending' },
      workflow,
      context: {
        trigger: { type: 'manual' },
        variables: { __zebric: { workflowPath: ['General'], currentWorkflow: 'General' } },
        session
      }
    } as DurableWorkflowPayload
    const step = checkpoints()
    await expect(engine.runDurable(structuredClone(payload), step)).rejects.toThrow('retry me')
    const result = await engine.runDurable(structuredClone(payload), step)
    expect(create).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenLastCalledWith('test', 'send', { record: { id: 'created', count: 7 } }, expect.any(Object))
    expect(result.sent).toEqual({ sent: true })
    expect(step.sleep).toHaveBeenCalledWith('steps.1', 60000)
    expect(step.do).toHaveBeenCalledWith(
      'steps.0',
      { retries: { limit: 1, delay: 1000, backoff: 'linear' }, timeout: 1234 },
      expect.any(Function)
    )
  })

  it('uses provider lifecycle controls and sanitizes failures', async () => {
    const db = new D1Adapter(new MockD1Database() as any)
    const provider = backend()
    const engine = new D1WorkflowExecutor(
      { workflows: [{ name: 'General', trigger: { manual: true }, steps: [] }] } as any,
      db,
      {} as any,
      {},
      provider.binding
    )
    const job = await engine.triggerManual('General', {}, session)
    expect(await engine.cancelJob(job.id)).toBe(true)
    expect((await engine.getJob(job.id))!.status).toBe('cancelled')
    expect(await engine.cancelJob(job.id)).toBe(false)
    provider.instances.get(job.id)!.state = { status: 'errored', error: { message: 'private secret' } }
    expect((await engine.getJob(job.id))!.error).toBe('Workflow execution failed')
    expect(await engine.retryJob(job.id)).toBe(true)
    expect(provider.restart).toHaveBeenCalledWith(job.id)
    expect((await engine.getJob(job.id))!.status).toBe('pending')
    expect((await engine.getJob(job.id))!.error).toBeUndefined()
  })
  it('serializes concurrent retry requests across isolates', async () => {
    const db = new D1Adapter(new MockD1Database() as any)
    const provider = backend()
    const blueprint = { workflows: [{ name: 'General', trigger: { manual: true }, steps: [] }] } as any
    const first = new D1WorkflowExecutor(blueprint, db, {} as any, {}, provider.binding)
    const second = new D1WorkflowExecutor(blueprint, db, {} as any, {}, provider.binding)
    const job = await first.triggerManual('General', {}, session)
    provider.instances.get(job.id)!.state = { status: 'errored' }
    const results = await Promise.all([first.retryJob(job.id), second.retryJob(job.id)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(provider.restart).toHaveBeenCalledTimes(1)
  })
  it('does not overwrite completion metadata when polling races with the entrypoint', async () => {
    const db = new D1Adapter(new MockD1Database() as any)
    const provider = backend()
    const engine = new D1WorkflowExecutor({ workflows: [{ name: 'General', trigger: { manual: true }, steps: [] }] } as any, db, {} as any, {}, provider.binding)
    const job = await engine.triggerManual('General', {}, session)
    const completed = { ...job, status: 'completed', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', result: { done: true } }
    provider.instances.get(job.id)!.state = { status: 'complete', output: { done: true } }
    provider.binding.get.mockImplementationOnce(async () => ({ status: async () => {
      await db.query('UPDATE _zebric_workflow_jobs SET job_json = ? WHERE id = ?', [JSON.stringify(completed), job.id])
      return { status: 'complete', output: { done: true } }
    } }))
    await engine.getJob(job.id)
    expect(await engine.getJob(job.id)).toMatchObject({ startedAt: completed.startedAt, completedAt: completed.completedAt })
  })

})
