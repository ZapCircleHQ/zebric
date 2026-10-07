/**
 * Workflow Manager
 *
 * Main interface for managing and executing workflows
 */

import { EventEmitter } from 'node:events'
import { createExecutionId, type Logger } from '@zebric/observability'
import { ServiceRegistry, SYSTEM_SESSION } from '@zebric/runtime-core'
import type { CommandExecutor, ExecutionObserverPort } from '@zebric/runtime-core'
import { WorkflowQueue, type WorkflowQueueOptions } from './workflow-queue.js'
import { WorkflowExecutor } from './workflow-executor.js'
import { DurableWorkflowQueue, workflowSubmissionId } from './durable-workflow-queue.js'
import { WorkflowStore, type WorkflowEvent } from './workflow-store.js'
import { analyzeTransactionalWorkflow } from '@zebric/runtime-core'
import type { Workflow, WorkflowJob, WorkflowContext, WorkflowTrigger } from './types.js'
import type { QueryExecutor } from '../database/query-executor.js'
import type { NotificationManager } from '@zebric/notifications'

export interface WorkflowManagerOptions extends WorkflowQueueOptions {
  dataLayer: QueryExecutor
  pluginRegistry?: any
  emailService?: any
  httpClient?: any
  notificationService?: NotificationManager
  logger?: Logger
  enqueueTransactionalAudit?: (job: WorkflowJob, workflow: Workflow) => Promise<void>
  deliverAuditOutbox?: () => Promise<void>
  enqueueOutcomeAudit?: (job: WorkflowJob, workflow: Workflow, success: boolean) => Promise<void>
  commandExecutor?: CommandExecutor
  executionObserver?: ExecutionObserverPort
  serviceRegistry?: ServiceRegistry
  /** Database-backed scheduling is enabled when the data layer supports runtime storage. */
  durable?: boolean
  /** Delay recovery while the engine loads command handlers and integration dependencies. */
  startPaused?: boolean
}

export class WorkflowManager extends EventEmitter {
  private queue: WorkflowQueue | DurableWorkflowQueue
  private eventRecovery?: ReturnType<typeof setInterval>
  private drainingEvents?: Promise<void>
  private paused = false
  private executor: WorkflowExecutor
  private logger?: Logger
  private enqueueTransactionalAudit?: WorkflowManagerOptions['enqueueTransactionalAudit']
  private deliverAuditOutbox?: WorkflowManagerOptions['deliverAuditOutbox']
  private readonly maxEntityTriggerDepth = 5
  private readonly serviceRegistry: ServiceRegistry
  private readonly dataLayer: QueryExecutor
  private commandDefinitions?: Parameters<typeof analyzeTransactionalWorkflow>[1]

  constructor(options: WorkflowManagerOptions) {
    super()
    this.paused = options.startPaused === true
    this.logger = options.logger
    this.dataLayer = options.dataLayer
    this.enqueueTransactionalAudit = options.enqueueTransactionalAudit
    this.deliverAuditOutbox = options.deliverAuditOutbox
    this.serviceRegistry = options.serviceRegistry ?? new ServiceRegistry()

    // Initialize queue
    const queueOptions = {
      maxConcurrent: options.maxConcurrent,
      retryDelay: options.retryDelay,
      maxRetries: options.maxRetries,
      jobTimeout: options.jobTimeout,
      logger: options.logger,
      onOutcome: options.enqueueOutcomeAudit,
      startPaused: options.startPaused,
    }
    this.queue = options.durable !== false && typeof options.dataLayer.queryRuntime === 'function'
      ? new DurableWorkflowQueue(new WorkflowStore(options.dataLayer), queueOptions)
      : new WorkflowQueue(queueOptions)
    if (this.queue instanceof DurableWorkflowQueue) {
      options.dataLayer.setMutationObserver(async ({ context, ...event }) => {
        if (context?.source === 'workflow') return
        await this.enqueueEntityEvent({ ...event, session: context?.session,
          trace: { correlationId: context?.correlationId, requestId: undefined } })
      })
      this.eventRecovery = setInterval(() => {
        if (this.paused) return
        void this.deliverPendingEvents()
        void this.deliverAuditOutbox?.().catch(error => this.logger?.error('Workflow audit recovery failed', { error }))
      }, 1000)
      this.eventRecovery.unref()
    }

    // Initialize executor
    this.executor = new WorkflowExecutor({
      dataLayer: options.dataLayer,
      pluginRegistry: options.pluginRegistry,
      emailService: options.emailService,
      httpClient: options.httpClient,
      notificationService: options.notificationService,
      commandExecutor: options.commandExecutor,
      executionObserver: options.executionObserver,
      services: this.serviceRegistry,
      logger: options.logger,
      enqueueEntityEvent: this.queue instanceof DurableWorkflowQueue
        ? (event, id) => (this.queue as DurableWorkflowQueue).store.enqueueEvent(event, id)
        : undefined,
      onEntityEvent: async ({ entity, event, before, after, sourceWorkflow, depth, workflowPath, trace, session, attribution }) => {
        await this.triggerEntityEvent(entity, event, { before, after }, {
          sourceWorkflow,
          depth: depth + 1,
          workflowPath,
          trace: trace
            ? {
                correlationId: trace.correlationId,
                requestId: trace.requestId,
              }
            : undefined,
          initiatingSession: session,
          attribution,
        })
      }
    })

    // Connect queue to executor
    this.setupQueueListeners()
  }

  start(): void {
    this.paused = false
    if (this.queue instanceof DurableWorkflowQueue) this.queue.start()
    void this.deliverPendingEvents()
  }

  setCommandExecutor(commandExecutor: CommandExecutor, executionObserver?: ExecutionObserverPort): void {
    this.commandDefinitions = commandExecutor.registry?.list?.()
    this.executor.setCommandExecutor(commandExecutor, executionObserver)
    if (executionObserver) this.serviceRegistry.setObserver(executionObserver)
  }

  getServiceRegistry(): ServiceRegistry {
    return this.serviceRegistry
  }

  /**
   * Setup queue event listeners
   */
  private setupQueueListeners(): void {
    // Execute jobs when they're ready
    this.queue.on('job:execute', async (job: WorkflowJob, workflow: Workflow) => {
      try {
        this.validateTransactionalWorkflow(workflow)
        const result = await this.executor.execute(workflow, job.context, {
          runner: this.queue instanceof DurableWorkflowQueue ? this.queue.runner(job, workflow) : undefined,
          signal: this.queue instanceof DurableWorkflowQueue ? this.queue.signal(job.id) : undefined,
          beforeTransactionalCommit: workflow.transactional && this.enqueueTransactionalAudit
            ? () => this.enqueueTransactionalAudit!(job, workflow)
            : undefined,
        })

        if (result.success) {
          if (workflow.transactional) {
            try {
              await this.deliverAuditOutbox?.()
            } catch (error) {
              this.logger?.error('Audit outbox delivery failed; intent remains pending', { error })
            }
          }
          await this.queue.completeJob(job.id, result.result)
          await this.deliverPendingEvents()
        } else {
          await this.queue.failJob(job.id, new Error(result.error || 'Unknown error'))
        }
      } catch (error) {
        await this.queue.failJob(job.id, error as Error)
      } finally {
        try {
          await this.deliverAuditOutbox?.()
        } catch (error) {
          this.logger?.error('Workflow outcome audit delivery failed; intent remains pending', { error })
        }
      }
    })

    this.queue.on('job:persistence-failed', (job, error) => {
      this.logger?.error('Workflow submission could not be persisted', { jobId: job.id, error })
      this.emit('job:persistence-failed', job, error)
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
  private validateTransactionalWorkflow(workflow: Workflow): void {
    if (workflow.transactional && this.queue instanceof DurableWorkflowQueue) {
      const analysis = analyzeTransactionalWorkflow(
        workflow as any, this.commandDefinitions ?? this.dataLayer.getBlueprint().commands ?? []
      )
      if (!analysis.databaseOnly) {
        throw new Error(`Transactional workflow ${workflow.name} must contain database-only steps`)
      }
    }
  }

  registerWorkflow(workflow: Workflow): void {
    this.validateTransactionalWorkflow(workflow)
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
  trigger(
    workflowName: string,
    data?: any,
    options?: {
      correlationId?: string
      requestId?: string
      submission?: { scope: string; fingerprint: string }
    }
  ): WorkflowJob {
    const context: WorkflowContext = {
      trace: {
        correlationId: options?.correlationId,
        requestId: options?.requestId,
        executionId: createExecutionId(),
      },
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

    return this.queue.enqueue(workflowName, context, options?.submission ? {
      id: workflowSubmissionId(options.submission.scope), fingerprint: options.submission.fingerprint,
    } : undefined)
  }

  /**
   * Trigger workflows based on entity event
   */
  async triggerEntityEvent(
    entity: string,
    event: 'create' | 'update' | 'delete',
    data: any,
    options?: {
      sourceWorkflow?: string
      depth?: number
      trace?: {
        correlationId?: string
        requestId?: string
      }
      initiatingSession?: WorkflowContext['session']
      attribution?: any
      workflowPath?: string[]
      childKey?: string
    }
  ): Promise<WorkflowJob[]> {
    const normalizedData = this.normalizeEntityEventData(data)
    const changed = normalizedData.after ?? normalizedData.before
    this.emit('entity:changed', {
      entity,
      event,
      id: changed?.id,
      audienceId: options?.initiatingSession?.actor?.credentialId ?? options?.initiatingSession?.user?.id,
    })
    const depth = options?.depth ?? 0
    if (depth > this.maxEntityTriggerDepth) {
      if (this.logger) {
        this.logger.warn('Skipping entity trigger because propagation depth was exceeded', {
          entity,
          event,
          depth,
          maxDepth: this.maxEntityTriggerDepth,
        })
      } else {
        console.warn(`Skipping entity trigger for ${entity}.${event}: exceeded propagation depth (${depth})`)
      }
      return []
    }

    const workflows = this.queue.getAllWorkflows()
    const jobs: WorkflowJob[] = []
    const workflowPath = options?.workflowPath ?? []

    for (const workflow of workflows) {
      if (workflow.enabled === false) continue
      if (this.matchesEntityTrigger(workflow.trigger, entity, event, normalizedData)) {
        if (workflowPath.includes(workflow.name)) {
          this.logger?.warn('Skipping entity trigger because it would create a workflow cycle', {
            entity,
            event,
            workflow: workflow.name,
            workflowPath,
          })
          continue
        }
        const context: WorkflowContext = {
          trace: {
            correlationId: options?.trace?.correlationId,
            requestId: options?.trace?.requestId,
            executionId: createExecutionId(),
          },
          trigger: {
            type: 'entity',
            entity,
            event,
            data: normalizedData.after,
            before: normalizedData.before,
            after: normalizedData.after,
          },
          variables: {
            entity: normalizedData.after,
            before: normalizedData.before,
            after: normalizedData.after,
            __zebric: {
              sourceWorkflow: options?.sourceWorkflow,
              depth,
              workflowPath: [...workflowPath, workflow.name],
            },
            ...(options?.attribution ? { data: { attribution: options.attribution } } : {}),
          },
          // Execute as trusted automation when no actor is known, but preserve the
          // initiating principal when this event came from an attributable mutation.
          session: options?.initiatingSession ?? SYSTEM_SESSION,
        }

        const job = this.queue.enqueue(workflow.name, context, options?.childKey ? {
          id: workflowSubmissionId(JSON.stringify([options.childKey, workflow.name])),
          fingerprint: workflowSubmissionId(JSON.stringify([options.childKey, workflow.name])),
        } : undefined)
        await this.ensurePersisted(job.id)
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
    correlationId?: string
    requestId?: string
  }, authorize: (workflow: Workflow) => boolean = () => true): Promise<WorkflowJob[]> {
    const workflows = this.queue.getAllWorkflows()
    const jobs: WorkflowJob[] = []

    for (const workflow of workflows) {
      if (workflow.enabled === false) continue
      if (this.matchesWebhookTrigger(workflow.trigger, path) && authorize(workflow)) {
        const context: WorkflowContext = {
          trace: {
            correlationId: request.correlationId,
            requestId: request.requestId,
            executionId: createExecutionId(),
          },
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
          session: SYSTEM_SESSION,
        }

        const job = this.queue.enqueue(workflow.name, context)
        await this.ensurePersisted(job.id)
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
      if (workflow.enabled === false) continue
      if (this.matchesScheduleTrigger(workflow.trigger, cronExpression)) {
        const context: WorkflowContext = {
          trace: {
            executionId: createExecutionId(),
          },
          trigger: {
            type: 'schedule',
          },
          variables: {
            timestamp: new Date().toISOString(),
          },
          session: SYSTEM_SESSION,
        }

        const job = this.queue.enqueue(workflow.name, context)
        await this.ensurePersisted(job.id)
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

  get durable(): boolean { return this.queue instanceof DurableWorkflowQueue }
  async ensurePersisted(id: string): Promise<WorkflowJob | undefined> {
    return this.queue instanceof DurableWorkflowQueue ? this.queue.ready(id) : this.queue.getJob(id)
  }
  async getDurableJob(id: string): Promise<WorkflowJob | undefined> {
    return this.queue instanceof DurableWorkflowQueue ? this.queue.getDurableJob(id) : this.queue.getJob(id)
  }
  async cancelDurableJob(id: string): Promise<boolean> {
    return this.queue instanceof DurableWorkflowQueue ? this.queue.cancelDurable(id) : this.queue.cancel(id)
  }
  async retryDurableJob(id: string): Promise<boolean> {
    return this.queue instanceof DurableWorkflowQueue ? this.queue.retryDurable(id) : this.queue.retry(id)
  }
  async enqueueEntityEvent(event: WorkflowEvent, id?: string): Promise<void> {
    if (!(this.queue instanceof DurableWorkflowQueue)) throw new Error('Durable workflow events require database scheduling')
    await this.queue.store.enqueueEvent(event, id)
  }
  async deliverPendingEvents(): Promise<void> {
    if (!(this.queue instanceof DurableWorkflowQueue) || this.paused) return
    if (this.dataLayer.inTransaction) {
      await this.dataLayer.afterCommit(() => this.dataLayer.outsideTransaction(() => this.deliverPendingEvents()))
      return
    }
    if (this.drainingEvents) return this.drainingEvents
    this.drainingEvents = this.queue.store.drainEvents(async (event, id) => {
      await this.triggerEntityEvent(event.entity, event.event, { before: event.before, after: event.after }, {
        sourceWorkflow: event.sourceWorkflow, depth: (event.depth ?? -1) + 1, workflowPath: event.workflowPath,
        trace: event.trace, initiatingSession: event.session, attribution: event.attribution, childKey: id,
      })
    }).catch(error => this.logger?.error('Workflow event recovery failed', { error })).finally(() => { this.drainingEvents = undefined })
    return this.drainingEvents
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
    if (this.eventRecovery) clearInterval(this.eventRecovery)
    await this.drainingEvents
    await this.queue.shutdown(timeoutMs)
  }

  /**
   * Check if trigger matches entity event
   */
  private matchesEntityTrigger(
    trigger: WorkflowTrigger,
    entity: string,
    event: 'create' | 'update' | 'delete',
    data: { before?: any; after: any }
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
      const conditionData = {
        ...(data.after && typeof data.after === 'object' ? data.after : {}),
        before: data.before,
        after: data.after,
      }
      return this.evaluateCondition(trigger.condition, conditionData)
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
      if (key === '$and') {
        if (!Array.isArray(value)) {
          return false
        }
        return value.every((cond) => this.evaluateCondition(cond, data))
      }

      if (key === '$or') {
        if (!Array.isArray(value)) {
          return false
        }
        return value.some((cond) => this.evaluateCondition(cond, data))
      }

      const actualValue = this.getValueByPath(data, key)

      if (value && typeof value === 'object') {
        for (const [op, expected] of Object.entries(value)) {
          switch (op) {
            case '$eq':
              if (actualValue !== expected) return false
              break
            case '$ne':
              if (actualValue === expected) return false
              break
            default:
              return false
          }
        }
      } else if (actualValue !== value) {
        return false
      }
    }
    return true
  }

  private normalizeEntityEventData(data: any): { before?: any; after: any } {
    if (data && typeof data === 'object' && ('before' in data || 'after' in data)) {
      const after = (data as any).after ?? {}
      return {
        before: (data as any).before,
        after,
      }
    }

    return { after: data }
  }

  private getValueByPath(obj: any, path: string): any {
    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined
      }
      current = current[part]
    }

    return current
  }
}
