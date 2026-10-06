import {
  SYSTEM_SESSION,
  analyzeTransactionalWorkflow,
  evaluateCondition,
  type CommandExecutor,
  type ServiceInvoker,
  type Blueprint,
  type UserSession,
  type Workflow,
  type WorkflowStep
} from '@zebric/runtime-core'
import {
  D1WorkflowJobStore,
  sanitizedSession,
  type DurableWorkflowBinding,
  type DurableWorkflowPayload,
  type DurableWorkflowStep
} from './durable-workflow.js'
import { createInlineStepRunner } from './inline-step-runner.js'
import { requestFingerprint } from '../api/idempotency-cache.js'
import type { D1Adapter } from '../database/d1-adapter.js'
import type { WorkersQueryExecutor } from '../query/workers-query-executor.js'

export interface WorkersWorkflowJob {
  id: string
  workflowName: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  ownerId?: string
  createdAt: string
  startedAt?: string
  attempts?: number
  /** Internal submission fingerprint; never exposed by the job API. */
  submissionFingerprint?: string
  completedAt?: string
  result?: Record<string, unknown>
  error?: string
}

export interface WorkersWorkflowServices {
  commandExecutor?: CommandExecutor
  services?: ServiceInvoker
  emailService?: { send(to: string, subject: string, body: string, template?: string): Promise<void> }
  notificationService?: { send(message: Record<string, unknown>): Promise<unknown> }
  pluginRegistry?: {
    getPlugin(
      name: string
    ): { actions?: Record<string, (params: Record<string, unknown>, context: WorkflowContext) => unknown> } | undefined
  }
  httpClient?: {
    request(
      url: string,
      options: { method: string; headers?: Record<string, string>; body?: unknown }
    ): Promise<unknown>
  }
}

interface EntityEvent {
  entity: string
  event: 'create' | 'update' | 'delete'
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

interface ExecutionFrame {
  durable?: DurableWorkflowStep
  workflow: Workflow
  jobId: string
  path: string
  events?: EntityEvent[]
  signal?: AbortSignal
}

export interface WorkflowContext {
  trigger: {
    type: 'manual' | 'entity' | 'schedule' | 'webhook'
    entity?: string
    event?: string
    data?: unknown
    before?: unknown
    after?: unknown
  }
  variables: Record<string, any>
  session?: UserSession
  request?: { headers: Record<string, string>; body?: unknown; query?: Record<string, string> }
}

const JOB_TTL_MS = 60 * 60 * 1000
const MAX_JOBS = 1000

/** Executes general workflows and database-only transactions backed by atomic D1 commits. */
export class D1WorkflowExecutor {
  private readonly workflows = new Map<string, Workflow>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly executions = new Map<string, { workflow: Workflow; context: WorkflowContext }>()
  private readonly jobStore?: D1WorkflowJobStore
  private readonly jobs = new Map<string, WorkersWorkflowJob>()

  constructor(
    private readonly blueprint: Blueprint,
    private readonly db: D1Adapter,
    private readonly queries: WorkersQueryExecutor,
    private readonly integrations: WorkersWorkflowServices = {},
    private readonly binding?: DurableWorkflowBinding
  ) {
    if (
      blueprint.entities?.some((entity) =>
        ['_zebric_workflow_jobs', '_zebric_workflow_job_controls'].includes(entity.name.toLowerCase())
      )
    )
      throw new Error('Entity names for internal workflow storage are reserved')
    if (binding) this.jobStore = new D1WorkflowJobStore(db)
    for (const workflow of blueprint.workflows ?? []) {
      const analysis = analyzeTransactionalWorkflow(workflow, blueprint.commands ?? [])
      if (workflow.transactional && !analysis.databaseOnly) {
        const reason = analysis.reasons.join('; ')
        throw new Error(`Cloudflare Workers workflow ${workflow.name} is unsupported: ${reason}`)
      }
      this.workflows.set(workflow.name, workflow)
    }
  }

  has(name: string): boolean {
    return this.workflows.has(name) && this.workflows.get(name)?.enabled !== false
  }

  list(): Workflow[] {
    return [...this.workflows.values()]
  }

  async getJob(id: string, ownerId?: string): Promise<WorkersWorkflowJob | undefined> {
    if (!this.binding || !this.jobStore) {
      const job = this.jobs.get(id)
      return ownerId && job?.ownerId !== ownerId ? undefined : job
    }
    const job = await this.jobStore.get(id)
    if (!job || (ownerId && job.ownerId !== ownerId)) return undefined
    const instance = await this.binding.get(id)
    const state = await instance.status()
    const storedSnapshot = structuredClone(job)
    const storedStatus = job.status
    switch (state.status) {
      case 'queued':
        job.status = 'pending'
        job.completedAt = undefined
        job.error = undefined
        job.result = undefined
        break
      case 'running':
      case 'waiting':
      case 'paused':
      case 'waitingForPause':
        job.status = 'running'
        job.completedAt = undefined
        job.error = undefined
        job.result = undefined
        break
      case 'terminated':
        job.status = 'cancelled'
        break
      case 'errored':
        job.status = 'failed'
        job.error = 'Workflow execution failed'
        break
      case 'complete':
        job.status = 'completed'
        job.result = state.output as Record<string, unknown>
        job.error = undefined
        break
      case 'unknown':
        if (job.error === 'Workflow submission failed') return job
        throw new Error('Workflow instance status is unavailable')
    }
    if (['completed', 'failed', 'cancelled'].includes(job.status)) job.completedAt ??= new Date().toISOString()
    // Completion metadata is written before the provider publishes its terminal
    // status. A poll during that window must not erase it.
    if (
      !(['completed', 'failed', 'cancelled'].includes(storedStatus) && ['running', 'waiting'].includes(state.status))
    ) {
      await this.jobStore.update(job, storedSnapshot)
    }
    return job
  }

  async getJobs(
    filter: { status?: WorkersWorkflowJob['status']; workflowName?: string; ownerId?: string } = {}
  ): Promise<WorkersWorkflowJob[]> {
    const stored = this.jobStore ? await this.jobStore.list(filter) : [...this.jobs.values()]
    const jobs = await Promise.all(stored.map((job) => this.getJob(job.id)))
    return jobs.filter((job): job is WorkersWorkflowJob =>
      Boolean(
        job &&
        (!filter.status || job.status === filter.status) &&
        (!filter.workflowName || job.workflowName === filter.workflowName) &&
        (!filter.ownerId || job.ownerId === filter.ownerId)
      )
    )
  }

  private async withJobControl(id: string, operation: () => Promise<boolean>): Promise<boolean> {
    if (!this.jobStore) return operation()
    // Check existence before inserting the control lease's foreign key.
    if (!(await this.jobStore.get(id))) return false
    return (await this.jobStore.withControl(id, operation)) ?? false
  }

  async cancelJob(id: string): Promise<boolean> {
    return this.withJobControl(id, async () => {
      const job = await this.getJob(id)
      if (!job || !['pending', 'running'].includes(job.status)) return false
      if (this.binding) {
        try {
          await (await this.binding.get(id)).terminate()
        } catch (error) {
          const current = await this.getJob(id)
          if (current && !['pending', 'running'].includes(current.status)) return false
          throw error
        }
      }
      job.status = 'cancelled'
      this.controllers.get(id)?.abort(new Error('Workflow cancelled'))
      job.completedAt = new Date().toISOString()
      if (this.jobStore) await this.jobStore.update(job)
      return true
    })
  }

  async retryJob(id: string): Promise<boolean> {
    return this.withJobControl(id, async () => {
      const job = await this.getJob(id)
      if (!job || job.status !== 'failed') return false
      if (!this.binding) {
        const execution = this.executions.get(id)
        if (!execution) return false
        await this.runInline(job, execution.workflow, structuredClone(execution.context))
        return true
      }
      await (await this.binding.get(id)).restart()
      // The binding is authoritative; do not overwrite a concurrently completed job.
      return true
    })
  }

  async cleanup(olderThanMs = JOB_TTL_MS): Promise<number> {
    if (this.jobStore) return this.jobStore.cleanup(olderThanMs)
    let count = 0
    for (const [id, job] of this.jobs) {
      if (job.completedAt && Date.parse(job.completedAt) < Date.now() - olderThanMs) {
        this.jobs.delete(id)
        this.executions.delete(id)
        count++
      }
    }
    return count
  }

  async triggerManual(
    name: string,
    data: Record<string, unknown>,
    session?: UserSession,
    submission?: { scope: string; fingerprint: string }
  ): Promise<WorkersWorkflowJob> {
    const context: WorkflowContext = {
      trigger: { type: 'manual', data },
      variables: { data },
      session
    }
    return this.execute(
      name,
      context,
      session,
      this.binding && submission ? await requestFingerprint(submission.scope) : undefined,
      submission?.fingerprint
    )
  }

  async triggerSchedule(cron: string): Promise<WorkersWorkflowJob[]> {
    const jobs = []
    for (const workflow of this.workflows.values()) {
      if (workflow.enabled === false || workflow.trigger.schedule !== cron) continue
      jobs.push(
        await this.execute(
          workflow.name,
          {
            trigger: { type: 'schedule' },
            variables: { timestamp: new Date().toISOString() },
            session: SYSTEM_SESSION
          },
          SYSTEM_SESSION
        )
      )
    }
    return jobs
  }

  /** The caller must authenticate webhook requests before authorizing a workflow. */
  async triggerWebhook(
    path: string,
    request: { headers: Record<string, string>; body?: unknown; query?: Record<string, string> },
    authorize: (workflow: Workflow) => boolean
  ): Promise<WorkersWorkflowJob[]> {
    const jobs = []
    for (const workflow of this.workflows.values()) {
      if (workflow.enabled === false || workflow.trigger.webhook !== path || !authorize(workflow)) continue
      jobs.push(
        await this.execute(
          workflow.name,
          {
            trigger: { type: 'webhook', data: request.body },
            variables: { webhook: request },
            session: SYSTEM_SESSION
          },
          SYSTEM_SESSION
        )
      )
    }
    return jobs
  }

  async triggerEntity(
    entity: string,
    event: 'create' | 'update' | 'delete',
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
    session?: UserSession | null,
    workflowPath: string[] = [],
    childKey?: string
  ): Promise<WorkersWorkflowJob[]> {
    const jobs: WorkersWorkflowJob[] = []
    for (const workflow of this.workflows.values()) {
      if (workflow.enabled === false || workflowPath.length >= 5 || workflowPath.includes(workflow.name)) continue
      if (workflow.trigger.entity !== entity || workflow.trigger.event !== event) continue
      const context: WorkflowContext = {
        trigger: { type: 'entity', entity, event, data: after, before, after },
        variables: { entity: after, before, after, __zebric: { workflowPath } },
        session: session ?? SYSTEM_SESSION
      }
      if (
        workflow.trigger.condition &&
        !evaluateCondition(workflow.trigger.condition, { ...after, ...context, before, after })
      )
        continue
      jobs.push(
        await this.execute(
          workflow.name,
          context,
          session ?? SYSTEM_SESSION,
          childKey ? await requestFingerprint(childKey, workflow.name) : undefined
        )
      )
    }
    return jobs
  }

  private async execute(
    name: string,
    context: WorkflowContext,
    ownerSession?: UserSession,
    id?: string,
    fingerprint?: string
  ): Promise<WorkersWorkflowJob> {
    if (id) {
      const stored = this.jobStore ? await this.jobStore.get(id) : this.jobs.get(id)
      if (stored) {
        if (stored.submissionFingerprint !== fingerprint)
          throw new Error('Idempotency key was reused with different input')
        if (!this.binding) return stored
        const state = await (await this.binding.get(id)).status()
        if (state.status !== 'unknown') return (await this.getJob(id))!
      }
    }
    const workflow = this.workflows.get(name)
    if (!workflow) throw new Error(`Workflow not found: ${name}`)
    if (workflow.enabled === false) throw new Error(`Workflow is disabled: ${name}`)
    if (workflow.precondition && !evaluateCondition(workflow.precondition, context)) {
      throw new Error(`Workflow precondition failed: ${name}`)
    }

    const propagation = (context.variables.__zebric ??= {})
    propagation.workflowPath = [...(propagation.workflowPath ?? []), name]
    propagation.currentWorkflow = name
    const now = new Date().toISOString()
    const job: WorkersWorkflowJob = {
      id: id ?? crypto.randomUUID(),
      workflowName: name,
      status: this.binding ? 'pending' : 'running',
      ownerId: securityId(ownerSession),
      createdAt: now,
      submissionFingerprint: fingerprint,
      startedAt: this.binding ? undefined : now
    }
    if (this.binding && this.jobStore) {
      const snapshot = JSON.parse(JSON.stringify(context)) as WorkflowContext
      snapshot.session = sanitizedSession(context.session)
      if (snapshot.variables.data?.session) snapshot.variables.data.session = snapshot.session
      await this.jobStore.put(job)
      // Re-read the winning insert: another isolate may have reserved this ID.
      const reserved = (await this.jobStore.get(job.id))!
      if (reserved.submissionFingerprint !== fingerprint)
        throw new Error('Idempotency key was reused with different input')
      try {
        await this.binding.create({ id: job.id, params: { job: reserved, workflow, context: snapshot } })
      } catch (error) {
        // Creation can race or its response can be lost. Only accept an existing
        // instance when the provider confirms it, otherwise surface the failure.
        const state = await (await this.binding.get(job.id)).status().catch(() => undefined)
        if (!state || state.status === 'unknown') {
          reserved.status = 'failed'
          reserved.error = 'Workflow submission failed'
          reserved.completedAt = new Date().toISOString()
          await this.jobStore.update(reserved)
          throw error
        }
      }
      return { ...reserved, status: 'pending', error: undefined, completedAt: undefined }
    }
    this.evictJobs()
    this.jobs.set(job.id, job)
    this.executions.set(job.id, { workflow, context: structuredClone(context) })
    await this.runInline(job, workflow, context)
    return job
  }

  private async runInline(job: WorkersWorkflowJob, workflow: Workflow, context: WorkflowContext): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(job.id, controller)
    job.attempts = 0
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    job.completedAt = undefined
    job.error = undefined
    job.result = undefined
    const runner = createInlineStepRunner(controller, (attempt) => {
      job.attempts = Math.max(job.attempts ?? 0, attempt)
    })
    try {
      job.result = await this.runSteps(workflow, context, {
        durable: runner,
        workflow,
        jobId: job.id,
        path: 'steps',
        signal: controller.signal
      })
      if (this.jobs.get(job.id)?.status !== 'cancelled') job.status = 'completed'
    } catch (error) {
      console.error(`Workflow ${workflow.name} failed:`, error)
      if (this.jobs.get(job.id)?.status !== 'cancelled') {
        job.status = 'failed'
        job.error = controller.signal.aborted ? 'Workflow execution timed out' : 'Workflow execution failed'
      }
    } finally {
      job.completedAt = new Date().toISOString()
      this.controllers.delete(job.id)
    }
  }

  /** Called from the Cloudflare-only entrypoint using a persisted workflow snapshot. */
  async runDurable(payload: DurableWorkflowPayload, step: DurableWorkflowStep): Promise<Record<string, unknown>> {
    const { workflow, context, job } = payload
    if (context.session) {
      context.session.createdAt = new Date(context.session.createdAt)
      context.session.expiresAt = new Date(context.session.expiresAt)
      if (context.variables.data?.session) context.variables.data.session = context.session
    }
    if (this.jobStore)
      await step.do('started', this.stepConfig(workflow), async () => {
        const stored = await this.jobStore!.get(job.id)
        if (stored) {
          stored.startedAt = new Date().toISOString()
          stored.completedAt = undefined
          stored.error = undefined
          stored.status = 'running'
          await this.jobStore!.update(stored)
        }
        return null
      })
    try {
      const result = await this.runSteps(workflow, context, { durable: step, workflow, jobId: job.id, path: 'steps' })
      await this.persistTerminalJob(job.id, 'completed', workflow, step, result)
      return result
    } catch (error) {
      await this.persistTerminalJob(job.id, 'failed', workflow, step)
      throw error
    }
  }

  private async persistTerminalJob(
    id: string,
    status: 'completed' | 'failed',
    workflow: Workflow,
    step: DurableWorkflowStep,
    result?: Record<string, unknown>
  ): Promise<void> {
    if (!this.jobStore) return
    await step.do(`job.${status}`, this.stepConfig(workflow), async () => {
      const stored = await this.jobStore!.get(id)
      if (stored) {
        stored.status = status
        stored.completedAt = new Date().toISOString()
        stored.result = result
        stored.error = status === 'failed' ? 'Workflow execution failed' : undefined
        await this.jobStore!.update(stored)
      }
      return null
    })
  }

  private async runSteps(
    workflow: Workflow,
    context: WorkflowContext,
    frame: ExecutionFrame
  ): Promise<Record<string, unknown>> {
    if (workflow.transactional) {
      const initialVariables = structuredClone(context.variables)
      const receipt = frame.durable
        ? {
            key: JSON.stringify(['workflow', frame.jobId, 'transaction']),
            fingerprint: await requestFingerprint(workflow.name, JSON.stringify(initialVariables))
          }
        : undefined
      const execute = async () =>
        this.queries.transaction(async () => {
          const transactionContext = { ...context, variables: structuredClone(initialVariables) }
          const events: EntityEvent[] = []
          await this.executeSteps(workflow.steps, transactionContext, { ...frame, durable: undefined, events })
          frame.signal?.throwIfAborted()
          return { result: transactionContext.variables, events }
        }, receipt)
      const output = frame.durable
        ? await frame.durable.do('transaction', this.stepConfig(workflow), execute)
        : await execute()
      await this.dispatchEvents(output.events, context, frame)
      return output.result
    }
    await this.executeSteps(workflow.steps, context, frame)
    return context.variables
  }

  private stepConfig(workflow: Workflow): {
    retries: { limit: number; delay: number; backoff: 'linear' }
    timeout: number
  } {
    return {
      retries: { limit: Math.max(0, (workflow.retries ?? 3) - 1), delay: 1000, backoff: 'linear' },
      timeout: workflow.timeout ?? 30000
    }
  }

  private async emitEntityEvent(event: EntityEvent, context: WorkflowContext, frame: ExecutionFrame): Promise<void> {
    frame.signal?.throwIfAborted()
    if (frame.events) {
      frame.events.push(event)
      return
    }
    await this.triggerEntity(
      event.entity,
      event.event,
      event.before,
      event.after,
      context.session,
      context.variables.__zebric.workflowPath
    )
  }

  private async dispatchEvents(events: EntityEvent[], context: WorkflowContext, frame: ExecutionFrame): Promise<void> {
    for (const [index, event] of events.entries()) {
      if (frame.durable) {
        await frame.durable.do(`${frame.path}.event.${index}`, this.stepConfig(frame.workflow), async () => {
          const jobs = await this.triggerEntity(
            event.entity,
            event.event,
            event.before,
            event.after,
            context.session,
            context.variables.__zebric.workflowPath,
            `${frame.jobId}:${frame.path}:${index}`
          )
          return jobs.map((job) => job.id)
        })
      } else {
        await this.emitEntityEvent(event, context, frame)
      }
    }
  }

  private async executeSteps(steps: WorkflowStep[], context: WorkflowContext, frame: ExecutionFrame): Promise<any[]> {
    const results = []
    for (const [index, step] of steps.entries()) {
      if (this.jobs.get(frame.jobId)?.status === 'cancelled') throw new Error('Workflow cancelled')
      const nested = { ...frame, path: `${frame.path}.${index}` }
      let result: any
      if (frame.durable && !['condition', 'loop', 'delay'].includes(step.type)) {
        const output = await frame.durable.do(nested.path, this.stepConfig(frame.workflow), async () => {
          const events: EntityEvent[] = []
          const value = await this.executeStep(step, context, { ...nested, events })
          return { value: value ?? null, hasValue: value !== undefined, events }
        })
        result = output.hasValue ? output.value : undefined
        await this.dispatchEvents(output.events, context, nested)
      } else {
        result = await this.executeStep(step, context, nested)
      }
      if (this.jobs.get(frame.jobId)?.status === 'cancelled') throw new Error('Workflow cancelled')
      if (step.assignTo && result !== undefined) context.variables[step.assignTo] = result
      results.push(result)
    }
    return results
  }

  private async executeStep(step: WorkflowStep, context: WorkflowContext, frame: ExecutionFrame): Promise<any> {
    const resolve = (value: unknown): any => resolveValue(value, context)
    frame.signal?.throwIfAborted()
    const queryContext = { session: context.session }
    switch (step.type) {
      case 'query': {
        if (!step.entity) throw new Error('Query step requires entity')
        const data = resolve(step.data)
        const where = resolve(step.where)
        if (step.action === 'find') return this.queries.execute({ entity: step.entity, where }, queryContext)
        if (step.action === 'create') {
          if (!data) throw new Error('Create action requires data')
          const created = await this.queries.create(step.entity, data, queryContext)
          await this.emitEntityEvent({ entity: step.entity, event: 'create', after: created }, context, frame)
          return created
        }
        const id = typeof where === 'string' ? where : where?.id
        if (id == null) throw new Error('Mutation requires an id in the where clause')
        const before = await this.queries.findById(step.entity, String(id), queryContext)
        if (step.action === 'update') {
          if (!data) throw new Error('Update action requires data')
          // Use the guarded batch compiler to preserve additional where predicates.
          const statements = await this.queries.prepareBatchMutation(
            step.entity,
            'update',
            data,
            typeof where === 'string' ? { id: where } : where,
            queryContext
          )
          frame.signal?.throwIfAborted()
          await this.queries.executeBatch(statements)
          const updated = await this.queries.findById(step.entity, String(id), queryContext)
          await this.emitEntityEvent({ entity: step.entity, event: 'update', before, after: updated }, context, frame)
          return updated
        }
        if (step.action === 'delete') {
          const statements = await this.queries.prepareBatchMutation(
            step.entity,
            'delete',
            undefined,
            typeof where === 'string' ? { id: where } : where,
            queryContext
          )
          frame.signal?.throwIfAborted()
          await this.queries.executeBatch(statements)
          await this.emitEntityEvent({ entity: step.entity, event: 'delete', before }, context, frame)
          return { deleted: true }
        }
        throw new Error('Unknown query action')
      }
      case 'command': {
        if (!this.integrations.commandExecutor || !step.command || !step.recordId)
          throw new Error('Command step is not configured')
        const definition = this.integrations.commandExecutor.registry.get(step.command)
        const recordId = String(resolve(step.recordId))
        const input = resolve(step.input) ?? {}
        const receipt = frame.durable
          ? {
              key: JSON.stringify(['workflow-command', frame.jobId, frame.path]),
              fingerprint: await requestFingerprint(step.command, recordId, JSON.stringify(input))
            }
          : undefined
        frame.signal?.throwIfAborted()
        const { result, before } = await this.queries.transaction(async () => {
          const before = definition
            ? await this.queries.findById(definition.entity, recordId, queryContext).catch(() => undefined)
            : undefined
          const result = await this.integrations.commandExecutor!.execute({
            command: step.command!,
            recordId,
            input,
            context: {
              session: context.session,
              source: 'workflow',
              workflow: context.variables.__zebric.currentWorkflow,
              workflowContext: context.variables
            }
          })
          frame.signal?.throwIfAborted()
          return { result, before }
        }, receipt)
        if (definition)
          await this.emitEntityEvent(
            { entity: definition.entity, event: 'update', before, after: result.record },
            context,
            frame
          )
        return result.record
      }
      case 'service':
        if (!this.integrations.services || !step.service || !step.operation)
          throw new Error('Service step is not configured')
        return this.integrations.services.invoke(step.service, step.operation, resolve(step.params) ?? {}, {
          actor: context.session?.actor
            ? {
                ...context.session.actor,
                roles: context.session.actor.roles ?? [],
                scopes: context.session.actor.scopes ?? []
              }
            : undefined,
          workflow: context.variables.__zebric.currentWorkflow,
          workflowContext: context.variables
        })
      case 'condition':
        if (!step.if) throw new Error('Condition step requires if')
        await this.executeSteps(evaluateCondition(step.if, context) ? (step.then ?? []) : (step.else ?? []), context, {
          ...frame,
          path: `${frame.path}.branch`
        })
        return
      case 'loop': {
        if (!step.items || !step.do) throw new Error('Loop step requires items and do')
        const items = getPath(context, step.items.replace(/^\s*\{\{|\}\}\s*$/g, '').trim()) ?? resolve(step.items)
        if (!Array.isArray(items)) throw new Error('Loop items must be an array')
        const results = []
        for (const [index, item] of items.entries()) {
          const nested = { ...context, variables: { ...context.variables, item, index } }
          results.push(...(await this.executeSteps(step.do, nested, { ...frame, path: `${frame.path}.loop.${index}` })))
        }
        return results
      }
      case 'delay':
        if (!Number.isFinite(step.duration) || Number(step.duration) < 0)
          throw new Error('Delay requires a non-negative duration')
        if (frame.durable) await frame.durable.sleep(frame.path, Number(step.duration))
        else await new Promise((resolve) => setTimeout(resolve, step.duration))
        return
      case 'webhook': {
        if (!step.url) throw new Error('Webhook step requires url')
        const options = { method: step.method ?? 'POST', headers: resolve(step.headers), body: resolve(step.payload) }
        if (this.integrations.httpClient) return this.integrations.httpClient.request(resolve(step.url), options)
        const response = await fetch(resolve(step.url), {
          method: options.method,
          headers: {
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body)
        })
        if (!response.ok) throw new Error(`Webhook failed: ${response.status}`)
        return response.status === 204 ? undefined : response.json()
      }
      case 'email':
        if (!this.integrations.emailService || !step.to || !step.subject)
          throw new Error('Email step is not configured')
        return this.integrations.emailService.send(
          resolve(step.to),
          resolve(step.subject),
          resolve(step.body) ?? '',
          step.template
        )
      case 'notify':
        if (!this.integrations.notificationService) throw new Error('Notification service is not configured')
        return this.integrations.notificationService.send(
          Object.fromEntries(
            ['adapter', 'channel', 'to', 'subject', 'body', 'template', 'params', 'metadata'].map((key) => [
              key,
              resolve((step as any)[key])
            ])
          )
        )
      case 'plugin': {
        if (!step.plugin || !step.action_name) throw new Error('Plugin step requires plugin and action_name')
        const action = this.integrations.pluginRegistry?.getPlugin(step.plugin)?.actions?.[step.action_name]
        if (!action) throw new Error('Plugin action is not configured')
        return action(resolve(step.params) ?? {}, context)
      }
      default:
        throw new Error(`Unsupported workflow step: ${step.type}`)
    }
  }

  /** Jobs live in isolate memory; drop expired ones and cap the total. */
  private evictJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS
    for (const [id, job] of this.jobs) {
      if (job.completedAt && Date.parse(job.completedAt) < cutoff) {
        this.jobs.delete(id)
        this.executions.delete(id)
      }
    }
    while (this.jobs.size >= MAX_JOBS) {
      const oldest = [...this.jobs].find(([, job]) => job.completedAt)?.[0]
      if (oldest === undefined) break
      this.jobs.delete(oldest)
      this.executions.delete(oldest)
    }
  }
}

function resolveValue(value: unknown, context: WorkflowContext): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\s*\{\{([^}]+)\}\}\s*$/)
    if (exact?.[1]) {
      const resolved = getPath(context, exact[1].trim())
      if (resolved !== undefined) return resolved
    }
    return value.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
      const resolved = getPath(context, path.trim())
      return resolved === undefined ? match : String(primitiveValue(resolved) ?? '')
    })
  }
  if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, context))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, context)]))
  }
  return value
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current == null || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, value)
}

function primitiveValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  return object.value ?? object.id ?? object.label ?? JSON.stringify(object)
}

export function securityId(session?: UserSession | null): string | undefined {
  return session?.actor?.credentialId ?? session?.actor?.id ?? session?.user?.id ?? session?.userId
}
