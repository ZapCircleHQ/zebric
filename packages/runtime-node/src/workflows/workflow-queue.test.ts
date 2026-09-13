import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowQueue } from './workflow-queue.js'
import type { Workflow, WorkflowContext } from './types.js'

function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    name: 'process-order',
    trigger: { manual: true },
    steps: [],
    ...overrides,
  }
}

function context(status = 'ready'): WorkflowContext {
  return {
    trigger: { type: 'manual' },
    variables: { data: { record: { status } } },
    trace: {
      executionId: 'execution-1',
      correlationId: 'correlation-1',
      requestId: 'request-1',
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WorkflowQueue registration and admission', () => {
  it('registers, lists, retrieves, and unregisters workflows with events', () => {
    const queue = new WorkflowQueue()
    const registered = vi.fn()
    const unregistered = vi.fn()
    const definition = workflow()
    queue.on('workflow:registered', registered)
    queue.on('workflow:unregistered', unregistered)

    queue.registerWorkflow(definition)

    expect(queue.getWorkflow('process-order')).toBe(definition)
    expect(queue.getAllWorkflows()).toEqual([definition])
    expect(registered).toHaveBeenCalledWith(definition)

    queue.unregisterWorkflow('process-order')
    expect(queue.getWorkflow('process-order')).toBeUndefined()
    expect(unregistered).toHaveBeenCalledWith('process-order')
  })

  it('rejects nameless, missing, disabled, and precondition-failing workflows', () => {
    const queue = new WorkflowQueue()

    expect(() => queue.registerWorkflow(workflow({ name: '' })))
      .toThrow('Workflow must have a name')
    expect(() => queue.enqueue('missing', context()))
      .toThrow('Workflow not found: missing')

    queue.registerWorkflow(workflow({ name: 'disabled', enabled: false }))
    expect(() => queue.enqueue('disabled', context()))
      .toThrow('Workflow is disabled: disabled')

    queue.registerWorkflow(workflow({
      name: 'approved-only',
      precondition: { 'variables.data.record.status': 'approved' },
    }))
    expect(() => queue.enqueue('approved-only', context('submitted')))
      .toThrow('Workflow precondition failed: approved-only')
  })

  it('enqueues a workflow when its precondition passes', () => {
    const queue = new WorkflowQueue()
    const enqueued = vi.fn()
    const execute = vi.fn()
    queue.on('job:enqueued', enqueued)
    queue.on('job:execute', execute)
    queue.registerWorkflow(workflow({
      precondition: { 'variables.data.record.status': 'ready' },
    }))

    const job = queue.enqueue('process-order', context())

    expect(job).toMatchObject({
      workflowName: 'process-order',
      status: 'running',
      attempts: 1,
    })
    expect(job.id).toMatch(/^job_\d+_[a-z0-9]+$/)
    expect(enqueued).toHaveBeenCalledWith(job)
    expect(execute).toHaveBeenCalledWith(job, queue.getWorkflow('process-order'))
  })
})

describe('WorkflowQueue execution lifecycle', () => {
  it('honors max concurrency and starts the next pending job on completion', () => {
    const queue = new WorkflowQueue({ maxConcurrent: 1 })
    const execute = vi.fn()
    queue.on('job:execute', execute)
    queue.registerWorkflow(workflow())

    const first = queue.enqueue('process-order', context())
    const second = queue.enqueue('process-order', context())

    expect(first.status).toBe('running')
    expect(second.status).toBe('pending')
    expect(queue.getJobs({ status: 'pending' })).toEqual([second])
    expect(queue.getJobs({ workflowName: 'process-order' })).toHaveLength(2)
    expect(queue.getStats()).toMatchObject({ total: 2, pending: 1, running: 1 })

    queue.completeJob('unknown')
    queue.completeJob(first.id, { processed: true })

    expect(first).toMatchObject({ status: 'completed', result: { processed: true } })
    expect(first.completedAt).toBeInstanceOf(Date)
    expect(second.status).toBe('running')
    expect(execute).toHaveBeenCalledTimes(2)

    queue.completeJob(second.id)
    expect(queue.getStats()).toMatchObject({
      total: 2, pending: 0, running: 0, completed: 2, failed: 0, cancelled: 0, workflows: 1,
    })
  })

  it('cancels pending and running jobs but not terminal jobs', () => {
    const queue = new WorkflowQueue({ maxConcurrent: 1 })
    const cancelled = vi.fn()
    queue.on('job:cancelled', cancelled)
    queue.registerWorkflow(workflow())

    const running = queue.enqueue('process-order', context())
    const pending = queue.enqueue('process-order', context())

    expect(queue.cancel('unknown')).toBe(false)
    expect(queue.cancel(pending.id)).toBe(true)
    expect(pending.status).toBe('cancelled')
    expect(pending.completedAt).toBeInstanceOf(Date)
    expect(queue.getStats().pending).toBe(0)

    expect(queue.cancel(running.id)).toBe(true)
    expect(running.status).toBe('cancelled')
    expect(queue.cancel(running.id)).toBe(false)
    expect(cancelled).toHaveBeenCalledTimes(2)
  })

  it('fails a queued job if its workflow is removed before execution', () => {
    const queue = new WorkflowQueue({ maxConcurrent: 1 })
    const failed = vi.fn()
    queue.on('job:failed', failed)
    queue.registerWorkflow(workflow({ name: 'blocker' }))
    queue.registerWorkflow(workflow({ name: 'removed' }))

    const blocker = queue.enqueue('blocker', context())
    const removed = queue.enqueue('removed', context())
    queue.unregisterWorkflow('removed')
    queue.completeJob(blocker.id)

    expect(removed).toMatchObject({
      status: 'failed',
      error: 'Workflow not found: removed',
    })
    expect(removed.completedAt).toBeInstanceOf(Date)
    expect(failed).toHaveBeenCalledWith(removed)
  })

  it('converts synchronous executor-listener errors into job failures', async () => {
    const queue = new WorkflowQueue({ maxRetries: 1 })
    queue.registerWorkflow(workflow())
    queue.on('job:execute', () => { throw new Error('executor crashed') })

    const job = queue.enqueue('process-order', context())

    await vi.waitFor(() => expect(job.status).toBe('failed'))
    expect(job.error).toBe('executor crashed')
    expect(job.completedAt).toBeInstanceOf(Date)
  })
})

describe('WorkflowQueue retries and cleanup', () => {
  it('retries with backoff and fails after the configured attempt limit', async () => {
    vi.useFakeTimers()
    const logger = { warn: vi.fn(), info: vi.fn() }
    const queue = new WorkflowQueue({ maxRetries: 2, retryDelay: 25, logger: logger as any })
    const retried = vi.fn()
    const failed = vi.fn()
    queue.on('job:retry', retried)
    queue.on('job:failed', failed)
    queue.registerWorkflow(workflow())
    const job = queue.enqueue('process-order', context())

    queue.failJob(job.id, new Error('temporary failure'))

    expect(job).toMatchObject({ status: 'pending', attempts: 1, error: 'temporary failure' })
    expect(logger.warn).toHaveBeenCalledWith(
      'Workflow job failed and will be retried',
      expect.objectContaining({
        workflowName: 'process-order',
        attempt: 1,
        maxRetries: 2,
        retryDelayMs: 25,
        executionId: 'execution-1',
      }),
    )

    await vi.advanceTimersByTimeAsync(25)
    expect(retried).toHaveBeenCalledWith(job)
    expect(job).toMatchObject({ status: 'running', attempts: 2 })

    queue.failJob(job.id, new Error('permanent failure'))
    expect(job).toMatchObject({ status: 'failed', attempts: 2, error: 'permanent failure' })
    expect(job.completedAt).toBeInstanceOf(Date)
    expect(failed).toHaveBeenCalledWith(job)
  })

  it('uses a workflow retry override and the console fallback', async () => {
    vi.useFakeTimers()
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const queue = new WorkflowQueue({ maxRetries: 1, retryDelay: 5 })
    queue.registerWorkflow(workflow({ retries: 2 }))
    const job = queue.enqueue('process-order', context())

    queue.failJob(job.id, new Error('retry me'))

    expect(output).toHaveBeenCalledWith(expect.stringContaining('retrying in 5ms'))
    await vi.advanceTimersByTimeAsync(5)
    expect(job.attempts).toBe(2)
  })

  it('manually retries a terminal failure and resets its execution state', () => {
    const queue = new WorkflowQueue({ maxRetries: 1 })
    const retried = vi.fn()
    queue.on('job:retried', retried)
    queue.registerWorkflow(workflow())
    const job = queue.enqueue('process-order', context())
    queue.failJob(job.id, new Error('failed once'))

    expect(queue.retry('unknown')).toBe(false)
    expect(queue.retry(job.id)).toBe(true)
    expect(job).toMatchObject({ status: 'running', attempts: 1 })
    expect(job.error).toBeUndefined()
    expect(job.completedAt).toBeUndefined()
    expect(retried).toHaveBeenCalledWith(job)
  })

  it('handles failure after workflow removal and ignores unknown job IDs', () => {
    const queue = new WorkflowQueue()
    const failed = vi.fn()
    queue.on('job:failed', failed)
    queue.registerWorkflow(workflow())
    const job = queue.enqueue('process-order', context())
    queue.unregisterWorkflow('process-order')

    queue.failJob('unknown', new Error('ignored'))
    queue.failJob(job.id, new Error('definition removed'))

    expect(job).toMatchObject({ status: 'failed', error: 'definition removed' })
    expect(queue.getStats().running).toBe(0)
    expect(failed).toHaveBeenCalledWith(job)
  })

  it('cleans only old terminal jobs and emits the number removed', () => {
    const queue = new WorkflowQueue()
    const cleaned = vi.fn()
    queue.on('queue:cleaned', cleaned)
    queue.registerWorkflow(workflow())
    const old = queue.enqueue('process-order', context())
    queue.completeJob(old.id)
    old.completedAt = new Date(Date.now() - 10_000)

    const recent = queue.enqueue('process-order', context())
    queue.completeJob(recent.id)

    expect(queue.cleanup(1_000)).toBe(1)
    expect(queue.getJob(old.id)).toBeUndefined()
    expect(queue.getJob(recent.id)).toBe(recent)
    expect(cleaned).toHaveBeenCalledWith(1)
    expect(queue.cleanup(1_000)).toBe(0)
    expect(cleaned).toHaveBeenCalledTimes(1)
  })
})

describe('WorkflowQueue shutdown', () => {
  it('logs a clean shutdown when no jobs are running', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() }
    const queue = new WorkflowQueue({ logger: logger as any })

    await queue.shutdown(50)

    expect(logger.info).toHaveBeenNthCalledWith(1, 'Shutting down workflow queue', {
      runningJobs: 0,
      timeoutMs: 50,
    })
    expect(logger.info).toHaveBeenNthCalledWith(2, 'Workflow queue shut down')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('waits for running work and warns when shutdown times out', async () => {
    vi.useFakeTimers()
    const logger = { info: vi.fn(), warn: vi.fn() }
    const queue = new WorkflowQueue({ logger: logger as any })
    queue.registerWorkflow(workflow())
    queue.enqueue('process-order', context())

    const shutdown = queue.shutdown(50)
    await vi.advanceTimersByTimeAsync(100)
    await shutdown

    expect(logger.warn).toHaveBeenCalledWith(
      'Timed out waiting for workflow jobs to complete during shutdown',
      { runningJobs: 1, timeoutMs: 50 },
    )
    expect(logger.info).toHaveBeenLastCalledWith('Workflow queue shut down')
  })

  it('uses console messages when no logger is configured', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const queue = new WorkflowQueue()

    await queue.shutdown()

    expect(output).toHaveBeenCalledWith('🛑 Shutting down workflow queue...')
    expect(output).toHaveBeenCalledWith('✅ Workflow queue shut down')
  })
})
