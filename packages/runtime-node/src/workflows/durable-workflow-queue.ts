import { EventEmitter } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { evaluateCondition } from '@zebric/runtime-core'
import type { WorkflowQueueOptions, EnqueueOptions } from './workflow-queue.js'
import type { Workflow, WorkflowContext, WorkflowJob } from './types.js'
import { WorkflowStore, WorkflowSuspended, type StoredWorkflow } from './workflow-store.js'
import { DurableStepRunner } from './step-runner.js'

/** Database leases own execution; local maps only serve legacy synchronous accessors. */
export class DurableWorkflowQueue extends EventEmitter {
  private workflows = new Map<string, Workflow>()
  private jobs = new Map<string, WorkflowJob>()
  private writes = new Map<string, Promise<WorkflowJob>>()
  private executions = new Map<string, { job: StoredWorkflow; workflow: Workflow; controller: AbortController }>()
  private stopped = false
  private paused: boolean
  private ticking?: Promise<void>
  private timer: ReturnType<typeof setInterval>

  constructor(
    readonly store: WorkflowStore,
    private options: WorkflowQueueOptions & {
      onOutcome?: (job: WorkflowJob, workflow: Workflow, success: boolean) => Promise<void>
      startPaused?: boolean
    } = {}
  ) {
    super()
    this.paused = options.startPaused === true
    this.timer = setInterval(() => {
      void this.tick()
    }, 250)
    this.timer.unref()
  }
  registerWorkflow(workflow: Workflow): void {
    if (!workflow.name) throw new Error('Workflow must have a name')
    this.workflows.set(workflow.name, workflow)
    this.emit('workflow:registered', workflow)
    void this.tick()
  }
  unregisterWorkflow(name: string): void {
    this.workflows.delete(name)
    this.emit('workflow:unregistered', name)
  }
  getWorkflow(name: string): Workflow | undefined {
    return this.workflows.get(name)
  }
  getAllWorkflows(): Workflow[] {
    return [...this.workflows.values()]
  }

  enqueue(name: string, context: WorkflowContext, options: EnqueueOptions = {}): WorkflowJob {
    if (this.stopped) throw new Error('Workflow queue is shutting down')
    const workflow = this.workflows.get(name)
    if (!workflow) throw new Error(`Workflow not found: ${name}`)
    if (workflow.enabled === false) throw new Error(`Workflow is disabled: ${name}`)
    if (workflow.precondition && !evaluateCondition(workflow.precondition, context))
      throw new Error(`Workflow precondition failed: ${name}`)
    const job: WorkflowJob = {
      id: options.id ?? randomUUID(),
      workflowName: name,
      status: 'pending',
      context,
      createdAt: new Date(),
      attempts: 0
    }
    this.jobs.set(job.id, job)
    const writing = this.store.create(job, workflow, options.fingerprint).then(async (stored) => {
      this.jobs.set(job.id, stored)
      await this.store.db.afterCommit(() =>
        this.store.db.outsideTransaction(() => {
          try {
            if (stored.newlyCreated) this.emit('job:enqueued', stored)
          } catch (error) {
            this.options.logger?.error('Workflow submission notification failed', { error })
          }
          void this.tick()
        })
      )
      return stored
    })
    this.writes.set(job.id, writing)
    // Legacy synchronous callers still receive errors through the queue event bus.
    void writing.catch((error) => this.emit('job:persistence-failed', job, error))
    return job
  }
  async ready(id: string): Promise<WorkflowJob> {
    const writing = this.writes.get(id)
    const job = writing ? await writing : await this.store.get(id)
    if (!job) throw new Error('Workflow job was not found')
    this.writes.delete(id)
    return job
  }
  getJob(id: string): WorkflowJob | undefined {
    return this.jobs.get(id)
  }
  getJobs(filter?: { status?: WorkflowJob['status']; workflowName?: string }): WorkflowJob[] {
    return [...this.jobs.values()].filter(
      (job) =>
        (!filter?.status || job.status === filter.status) &&
        (!filter?.workflowName || job.workflowName === filter.workflowName)
    )
  }
  async getDurableJob(id: string): Promise<WorkflowJob | undefined> {
    await this.writes.get(id)
    const job = await this.store.get(id)
    if (job) this.jobs.set(id, job)
    return job
  }
  async cancelDurable(id: string): Promise<boolean> {
    await this.writes.get(id)
    const execution = this.executions.get(id)
    // Interrupt a local database effect before waiting for its transaction to release.
    if (execution?.controller.signal.aborted) return false
    execution?.controller.abort(new Error('Workflow cancelled'))
    const changed = await this.store.cancel(id)
    const job = await this.getDurableJob(id)
    if (changed) this.emit('job:cancelled', job)
    return changed || Boolean(execution && job?.status === 'cancelled')
  }
  cancel(id: string): boolean {
    const job = this.getJob(id)
    if (!job || !['pending', 'running'].includes(job.status)) return false
    void this.cancelDurable(id).catch((error) => this.options.logger?.error('Workflow cancellation failed', { error }))
    return true
  }
  async retryDurable(id: string): Promise<boolean> {
    const changed = await this.store.retry(id)
    if (changed) {
      this.emit('job:retry', await this.getDurableJob(id))
      void this.tick()
    }
    return changed
  }
  retry(id: string): boolean {
    const job = this.getJob(id)
    if (job?.status !== 'failed') return false
    void this.retryDurable(id).catch((error) => this.options.logger?.error('Workflow retry failed', { error }))
    return true
  }
  cleanup(olderThanMs = 3600000): number {
    const jobs = this.getJobs().filter((job) => job.completedAt && job.completedAt.getTime() < Date.now() - olderThanMs)
    void this.store.cleanup(Date.now() - olderThanMs)
    for (const job of jobs) this.jobs.delete(job.id)
    return jobs.length
  }
  getStats() {
    return {
      total: this.jobs.size,
      pending: this.getJobs({ status: 'pending' }).length,
      running: this.executions.size,
      completed: this.getJobs({ status: 'completed' }).length,
      failed: this.getJobs({ status: 'failed' }).length,
      cancelled: this.getJobs({ status: 'cancelled' }).length,
      workflows: this.workflows.size
    }
  }

  runner(job: WorkflowJob, workflow: Workflow): DurableStepRunner {
    const execution = this.executions.get(job.id)
    if (!execution) throw new Error('Workflow is not owned by this scheduler')
    return new DurableStepRunner(
      this.store,
      execution.job,
      {
        ...workflow,
        retries: workflow.retries ?? this.options.maxRetries,
        timeout: workflow.timeout ?? this.options.jobTimeout
      },
      execution.controller.signal,
      this.options.retryDelay ?? 1000
    )
  }
  signal(id: string): AbortSignal {
    return this.executions.get(id)!.controller.signal
  }

  start(): void {
    this.paused = false
    void this.tick()
  }
  async tick(): Promise<void> {
    if (this.stopped || this.paused) return
    if (this.ticking) return this.ticking
    this.ticking = this.claimAvailable()
      .catch((error) => {
        this.options.logger?.error('Workflow recovery tick failed', { error })
      })
      .finally(() => {
        this.ticking = undefined
      })
    return this.ticking
  }
  private async claimAvailable(): Promise<void> {
    for (const execution of this.executions.values()) {
      try {
        await this.store.assertOwned(execution.job)
      } catch (error) {
        execution.controller.abort(error)
      }
    }
    while (!this.stopped && this.executions.size < (this.options.maxConcurrent ?? 10)) {
      const names = [...this.workflows.values()]
        .filter((workflow) => workflow.enabled !== false)
        .map((workflow) => workflow.name)
      const claimed = await this.store.claim(names)
      if (!claimed) return
      const controller = new AbortController()
      this.executions.set(claimed.job.id, { job: claimed.job, workflow: claimed.workflow, controller })
      this.jobs.set(claimed.job.id, claimed.job)
      this.emit('job:started', claimed.job)
      this.emit('job:execute', claimed.job, claimed.workflow)
    }
  }
  async completeJob(id: string, result?: any): Promise<void> {
    await this.finish(id, 'completed', result)
  }
  async failJob(id: string, error: Error): Promise<void> {
    const execution = this.executions.get(id)
    if (!execution) return
    if (error instanceof WorkflowSuspended) {
      await this.finish(id, 'pending', undefined, error.until)
      return
    }
    execution.job.error = 'Workflow execution failed'
    await this.finish(id, this.stopped ? 'pending' : execution.controller.signal.aborted ? 'cancelled' : 'failed')
  }
  private async finish(id: string, status: WorkflowJob['status'], result?: any, until?: number): Promise<void> {
    const execution = this.executions.get(id)
    if (!execution) return
    try {
      const saved = await this.store.db.transaction(async () => {
        const saved = await this.store.finish(execution.job, status, result, until)
        if (saved && (status === 'completed' || status === 'failed'))
          await this.options.onOutcome?.(execution.job, execution.workflow, status === 'completed')
        return saved
      })
      const latest = await this.store.get(id)
      if (latest) this.jobs.set(id, latest)
      if (saved && status === 'completed') this.emit('job:completed', latest)
      if (saved && status === 'failed') this.emit('job:failed', latest)
      if (saved && status === 'cancelled') this.emit('job:cancelled', latest)
    } finally {
      this.executions.delete(id)
      void this.tick()
    }
  }
  async shutdown(timeoutMs = 30000): Promise<void> {
    this.stopped = true
    clearInterval(this.timer)
    await this.ticking
    await Promise.allSettled(this.writes.values())
    const deadline = Date.now() + timeoutMs
    while (this.executions.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    for (const execution of this.executions.values())
      execution.controller.abort(new Error('Workflow scheduler stopped'))
    while (this.executions.size) await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export function workflowSubmissionId(scope: string): string {
  return createHash('sha256').update(scope).digest('hex')
}
