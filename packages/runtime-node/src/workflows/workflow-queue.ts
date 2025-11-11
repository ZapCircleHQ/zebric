/**
 * Workflow Queue
 *
 * In-memory job queue for managing workflow execution
 */

import { EventEmitter } from 'node:events'
import type { WorkflowJob, WorkflowContext, Workflow } from './types.js'

export interface WorkflowQueueOptions {
  maxConcurrent?: number // Maximum concurrent jobs (default: 10)
  retryDelay?: number // Delay between retries in ms (default: 1000)
  maxRetries?: number // Default max retries (default: 3)
  jobTimeout?: number // Default job timeout in ms (default: 30000)
}

export interface EnqueueOptions {
  priority?: number // Higher priority jobs run first (default: 0)
  timeout?: number // Override default timeout
  retries?: number // Override default retries
}

export class WorkflowQueue extends EventEmitter {
  private jobs = new Map<string, WorkflowJob>()
  private pendingQueue: string[] = []
  private runningJobs = new Set<string>()
  private workflows = new Map<string, Workflow>()

  private readonly maxConcurrent: number
  private readonly retryDelay: number
  private readonly defaultMaxRetries: number

  constructor(options: WorkflowQueueOptions = {}) {
    super()
    this.maxConcurrent = options.maxConcurrent || 10
    this.retryDelay = options.retryDelay || 1000
    this.defaultMaxRetries = options.maxRetries || 3
  }

  /**
   * Register a workflow
   */
  registerWorkflow(workflow: Workflow): void {
    if (!workflow.name) {
      throw new Error('Workflow must have a name')
    }
    this.workflows.set(workflow.name, workflow)
    this.emit('workflow:registered', workflow)
  }

  /**
   * Unregister a workflow
   */
  unregisterWorkflow(name: string): void {
    this.workflows.delete(name)
    this.emit('workflow:unregistered', name)
  }

  /**
   * Get a registered workflow
   */
  getWorkflow(name: string): Workflow | undefined {
    return this.workflows.get(name)
  }

  /**
   * Get all registered workflows
   */
  getAllWorkflows(): Workflow[] {
    return Array.from(this.workflows.values())
  }

  /**
   * Enqueue a new job
   */
  enqueue(workflowName: string, context: WorkflowContext, _options: EnqueueOptions = {}): WorkflowJob {
    const workflow = this.workflows.get(workflowName)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowName}`)
    }

    if (workflow.enabled === false) {
      throw new Error(`Workflow is disabled: ${workflowName}`)
    }

    const job: WorkflowJob = {
      id: this.generateJobId(),
      workflowName,
      status: 'pending',
      context,
      createdAt: new Date(),
      attempts: 0,
    }

    this.jobs.set(job.id, job)
    this.pendingQueue.push(job.id)

    this.emit('job:enqueued', job)
    this.processQueue()

    return job
  }

  /**
   * Get a job by ID
   */
  getJob(id: string): WorkflowJob | undefined {
    return this.jobs.get(id)
  }

  /**
   * Get all jobs with optional filter
   */
  getJobs(filter?: { status?: WorkflowJob['status']; workflowName?: string }): WorkflowJob[] {
    let jobs = Array.from(this.jobs.values())

    if (filter?.status) {
      jobs = jobs.filter((job) => job.status === filter.status)
    }

    if (filter?.workflowName) {
      jobs = jobs.filter((job) => job.workflowName === filter.workflowName)
    }

    return jobs
  }

  /**
   * Cancel a job
   */
  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job) {
      return false
    }

    if (job.status === 'running') {
      // Can't cancel running jobs immediately, but mark them
      job.status = 'cancelled'
      this.emit('job:cancelled', job)
      return true
    }

    if (job.status === 'pending') {
      job.status = 'cancelled'
      job.completedAt = new Date()
      this.pendingQueue = this.pendingQueue.filter((jid) => jid !== id)
      this.emit('job:cancelled', job)
      return true
    }

    return false
  }

  /**
   * Retry a failed job
   */
  retry(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'failed') {
      return false
    }

    job.status = 'pending'
    job.attempts = 0
    job.error = undefined
    job.startedAt = undefined
    job.completedAt = undefined

    this.pendingQueue.push(job.id)
    this.emit('job:retried', job)
    this.processQueue()

    return true
  }

  /**
   * Clear completed and failed jobs older than specified time
   */
  cleanup(olderThanMs: number = 3600000): number {
    const now = Date.now()
    let cleaned = 0

    for (const [id, job] of this.jobs.entries()) {
      if (
        (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') &&
        job.completedAt &&
        now - job.completedAt.getTime() > olderThanMs
      ) {
        this.jobs.delete(id)
        cleaned++
      }
    }

    if (cleaned > 0) {
      this.emit('queue:cleaned', cleaned)
    }

    return cleaned
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      total: this.jobs.size,
      pending: this.pendingQueue.length,
      running: this.runningJobs.size,
      completed: this.getJobs({ status: 'completed' }).length,
      failed: this.getJobs({ status: 'failed' }).length,
      cancelled: this.getJobs({ status: 'cancelled' }).length,
      workflows: this.workflows.size,
    }
  }

  /**
   * Process the queue
   */
  private processQueue(): void {
    // Check if we can run more jobs
    if (this.runningJobs.size >= this.maxConcurrent) {
      return
    }

    // Check if there are pending jobs
    if (this.pendingQueue.length === 0) {
      return
    }

    // Get next job
    const jobId = this.pendingQueue.shift()
    if (!jobId) {
      return
    }

    const job = this.jobs.get(jobId)
    if (!job) {
      return
    }

    // Start the job
    this.runJob(job)

    // Try to process more jobs
    this.processQueue()
  }

  /**
   * Run a job
   */
  private async runJob(job: WorkflowJob): Promise<void> {
    const workflow = this.workflows.get(job.workflowName)
    if (!workflow) {
      job.status = 'failed'
      job.error = `Workflow not found: ${job.workflowName}`
      job.completedAt = new Date()
      this.emit('job:failed', job)
      return
    }

    // Mark as running
    job.status = 'running'
    job.startedAt = new Date()
    job.attempts++
    this.runningJobs.add(job.id)
    this.emit('job:started', job)

    try {
      // Emit event for executor to handle
      // The executor will be responsible for actually running the workflow
      this.emit('job:execute', job, workflow)

      // Note: The actual execution and completion is handled by the executor
      // via completeJob() and failJob() methods
    } catch (error) {
      await this.handleJobError(job, error as Error, workflow)
    }
  }

  /**
   * Complete a job successfully
   */
  completeJob(id: string, result?: any): void {
    const job = this.jobs.get(id)
    if (!job) {
      return
    }

    job.status = 'completed'
    job.result = result
    job.completedAt = new Date()
    this.runningJobs.delete(id)

    this.emit('job:completed', job)
    this.processQueue()
  }

  /**
   * Fail a job
   */
  failJob(id: string, error: Error): void {
    const job = this.jobs.get(id)
    if (!job) {
      return
    }

    const workflow = this.workflows.get(job.workflowName)
    if (workflow) {
      this.handleJobError(job, error, workflow)
    } else {
      job.status = 'failed'
      job.error = error.message
      job.completedAt = new Date()
      this.runningJobs.delete(id)
      this.emit('job:failed', job)
      this.processQueue()
    }
  }

  /**
   * Handle job error with retry logic
   */
  private async handleJobError(job: WorkflowJob, error: Error, workflow: Workflow): Promise<void> {
    const maxRetries = workflow.retries ?? this.defaultMaxRetries

    if (job.attempts < maxRetries) {
      // Retry the job
      console.log(
        `⚠️  Job ${job.id} failed (attempt ${job.attempts}/${maxRetries}), retrying in ${this.retryDelay}ms...`
      )

      job.status = 'pending'
      job.error = error.message
      this.runningJobs.delete(job.id)

      setTimeout(() => {
        this.pendingQueue.push(job.id)
        this.emit('job:retry', job)
        this.processQueue()
      }, this.retryDelay * job.attempts) // Exponential backoff
    } else {
      // Max retries reached, mark as failed
      job.status = 'failed'
      job.error = error.message
      job.completedAt = new Date()
      this.runningJobs.delete(job.id)

      this.emit('job:failed', job)
      this.processQueue()
    }
  }

  /**
   * Generate a unique job ID
   */
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Shutdown the queue gracefully
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    console.log('🛑 Shutting down workflow queue...')

    // Stop accepting new jobs
    this.pendingQueue = []

    // Wait for running jobs to complete
    const startTime = Date.now()
    while (this.runningJobs.size > 0) {
      if (Date.now() - startTime > timeoutMs) {
        console.warn(`⚠️  Timeout waiting for ${this.runningJobs.size} jobs to complete`)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    console.log('✅ Workflow queue shut down')
  }
}
