/**
 * Workflow Manager
 *
 * Main interface for managing and executing workflows
 */

import { EventEmitter } from 'node:events'
import { WorkflowQueue, type WorkflowQueueOptions } from './workflow-queue.js'
import { WorkflowExecutor } from './workflow-executor.js'
import type { Workflow, WorkflowJob, WorkflowContext, WorkflowTrigger } from './types.js'
import type { QueryExecutor } from '../database/query-executor.js'
import type { NotificationManager } from '@zebric/notifications'

export interface WorkflowManagerOptions extends WorkflowQueueOptions {
  dataLayer: QueryExecutor
  pluginRegistry?: any
  emailService?: any
  httpClient?: any
  notificationService?: NotificationManager
}

export class WorkflowManager extends EventEmitter {
  private queue: WorkflowQueue
  private executor: WorkflowExecutor

  constructor(options: WorkflowManagerOptions) {
    super()

    // Initialize queue
    this.queue = new WorkflowQueue({
      maxConcurrent: options.maxConcurrent,
      retryDelay: options.retryDelay,
      maxRetries: options.maxRetries,
      jobTimeout: options.jobTimeout,
    })

    // Initialize executor
    this.executor = new WorkflowExecutor({
      dataLayer: options.dataLayer,
      pluginRegistry: options.pluginRegistry,
      emailService: options.emailService,
      httpClient: options.httpClient,
      notificationService: options.notificationService,
    })

    // Connect queue to executor
    this.setupQueueListeners()
  }

  /**
   * Setup queue event listeners
   */
  private setupQueueListeners(): void {
    // Execute jobs when they're ready
    this.queue.on('job:execute', async (job: WorkflowJob, workflow: Workflow) => {
      try {
        const result = await this.executor.execute(workflow, job.context)

        if (result.success) {
          this.queue.completeJob(job.id, result.result)
        } else {
          this.queue.failJob(job.id, new Error(result.error || 'Unknown error'))
        }
      } catch (error) {
        this.queue.failJob(job.id, error as Error)
      }
    })

    // Forward queue events
    this.queue.on('job:enqueued', (job) => this.emit('job:enqueued', job))
    this.queue.on('job:started', (job) => this.emit('job:started', job))
    this.queue.on('job:completed', (job) => this.emit('job:completed', job))
    this.queue.on('job:failed', (job) => this.emit('job:failed', job))
    this.queue.on('job:cancelled', (job) => this.emit('job:cancelled', job))
    this.queue.on('job:retry', (job) => this.emit('job:retry', job))
    this.queue.on('workflow:registered', (workflow) => this.emit('workflow:registered', workflow))
    this.queue.on('workflow:unregistered', (name) => this.emit('workflow:unregistered', name))
  }

  /**
   * Register a workflow
   */
  registerWorkflow(workflow: Workflow): void {
    this.queue.registerWorkflow(workflow)
  }

  /**
   * Unregister a workflow
   */
  unregisterWorkflow(name: string): void {
    this.queue.unregisterWorkflow(name)
  }

  /**
   * Get a workflow
   */
  getWorkflow(name: string): Workflow | undefined {
    return this.queue.getWorkflow(name)
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): Workflow[] {
    return this.queue.getAllWorkflows()
  }

  /**
   * Trigger a workflow manually
   */
  trigger(workflowName: string, data?: any): WorkflowJob {
    const context: WorkflowContext = {
      trigger: {
        type: 'manual',
        data,
      },
      variables: {
        data,
      },
    }

    if (data?.session) {
      context.session = data.session
    }

    return this.queue.enqueue(workflowName, context)
  }

  /**
   * Trigger workflows based on entity event
   */
  async triggerEntityEvent(
    entity: string,
    event: 'create' | 'update' | 'delete',
    data: any
  ): Promise<WorkflowJob[]> {
    const workflows = this.queue.getAllWorkflows()
    const jobs: WorkflowJob[] = []

    for (const workflow of workflows) {
      if (this.matchesEntityTrigger(workflow.trigger, entity, event, data)) {
        const context: WorkflowContext = {
          trigger: {
            type: 'entity',
            entity,
            event,
            data,
          },
          variables: {
            entity: data,
          },
        }

        const job = this.queue.enqueue(workflow.name, context)
        jobs.push(job)
      }
    }

    return jobs
  }

  /**
   * Trigger workflows based on webhook
   */
  async triggerWebhook(path: string, request: {
    headers: Record<string, string>
    body?: any
    query?: Record<string, string>
  }): Promise<WorkflowJob[]> {
    const workflows = this.queue.getAllWorkflows()
    const jobs: WorkflowJob[] = []

    for (const workflow of workflows) {
      if (this.matchesWebhookTrigger(workflow.trigger, path)) {
        const context: WorkflowContext = {
          trigger: {
            type: 'webhook',
            data: request.body,
          },
          variables: {
            webhook: {
              body: request.body,
              headers: request.headers,
              query: request.query,
            },
          },
          request,
        }

        const job = this.queue.enqueue(workflow.name, context)
        jobs.push(job)
      }
    }

    return jobs
  }

  /**
   * Trigger workflows based on schedule
   */
  async triggerSchedule(cronExpression: string): Promise<WorkflowJob[]> {
    const workflows = this.queue.getAllWorkflows()
    const jobs: WorkflowJob[] = []

    for (const workflow of workflows) {
      if (this.matchesScheduleTrigger(workflow.trigger, cronExpression)) {
        const context: WorkflowContext = {
          trigger: {
            type: 'schedule',
          },
          variables: {
            timestamp: new Date().toISOString(),
          },
        }

        const job = this.queue.enqueue(workflow.name, context)
        jobs.push(job)
      }
    }

    return jobs
  }

  /**
   * Get a job by ID
   */
  getJob(id: string): WorkflowJob | undefined {
    return this.queue.getJob(id)
  }

  /**
   * Get jobs with optional filter
   */
  getJobs(filter?: { status?: WorkflowJob['status']; workflowName?: string }): WorkflowJob[] {
    return this.queue.getJobs(filter)
  }

  /**
   * Cancel a job
   */
  cancelJob(id: string): boolean {
    return this.queue.cancel(id)
  }

  /**
   * Retry a failed job
   */
  retryJob(id: string): boolean {
    return this.queue.retry(id)
  }

  /**
   * Clean up old jobs
   */
  cleanup(olderThanMs?: number): number {
    return this.queue.cleanup(olderThanMs)
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return this.queue.getStats()
  }

  /**
   * Shutdown the workflow manager
   */
  async shutdown(timeoutMs?: number): Promise<void> {
    await this.queue.shutdown(timeoutMs)
  }

  /**
   * Check if trigger matches entity event
   */
  private matchesEntityTrigger(
    trigger: WorkflowTrigger,
    entity: string,
    event: 'create' | 'update' | 'delete',
    data: any
  ): boolean {
    if (!trigger.entity || !trigger.event) {
      return false
    }

    if (trigger.entity !== entity) {
      return false
    }

    if (trigger.event !== event) {
      return false
    }

    // Check condition if specified
    if (trigger.condition) {
      return this.evaluateCondition(trigger.condition, data)
    }

    return true
  }

  /**
   * Check if trigger matches webhook
   */
  private matchesWebhookTrigger(trigger: WorkflowTrigger, path: string): boolean {
    if (!trigger.webhook) {
      return false
    }

    return trigger.webhook === path
  }

  /**
   * Check if trigger matches schedule
   */
  private matchesScheduleTrigger(trigger: WorkflowTrigger, cronExpression: string): boolean {
    if (!trigger.schedule) {
      return false
    }

    return trigger.schedule === cronExpression
  }

  /**
   * Simple condition evaluation
   */
  private evaluateCondition(condition: Record<string, any>, data: any): boolean {
    for (const [key, value] of Object.entries(condition)) {
      if (data[key] !== value) {
        return false
      }
    }
    return true
  }
}
