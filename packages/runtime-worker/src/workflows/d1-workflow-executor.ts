import {
  SYSTEM_SESSION,
  analyzeTransactionalWorkflow,
  evaluateCondition,
  type CommandExecutor,
  type ServiceInvoker,
  type Blueprint,
  type UserSession,
  type Workflow,
  type WorkflowStep,
} from '@zebric/runtime-core'
import type { D1Adapter } from '../database/d1-adapter.js'
import type { WorkersQueryExecutor } from '../query/workers-query-executor.js'

export interface WorkersWorkflowJob {
  id: string
  workflowName: string
  status: 'running' | 'completed' | 'failed'
  ownerId?: string
  createdAt: string
  startedAt: string
  completedAt?: string
  result?: Record<string, unknown>
  error?: string
}

export interface WorkersWorkflowServices {
  commandExecutor?: CommandExecutor
  services?: ServiceInvoker
  emailService?: { send(to: string, subject: string, body: string, template?: string): Promise<void> }
  notificationService?: { send(message: Record<string, unknown>): Promise<unknown> }
  pluginRegistry?: { getPlugin(name: string): { actions?: Record<string, (params: Record<string, unknown>, context: WorkflowContext) => unknown> } | undefined }
  httpClient?: { request(url: string, options: { method: string; headers?: Record<string, string>; body?: unknown }): Promise<unknown> }
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
}

const JOB_TTL_MS = 60 * 60 * 1000
const MAX_JOBS = 1000

/** Executes general workflows sequentially and eligible transactions as atomic D1 batches. */
export class D1WorkflowExecutor {
  private readonly workflows = new Map<string, Workflow>()
  private readonly jobs = new Map<string, WorkersWorkflowJob>()

  constructor(
    blueprint: Blueprint,
    private readonly db: D1Adapter,
    private readonly queries: WorkersQueryExecutor,
    private readonly integrations: WorkersWorkflowServices = {},
  ) {
    for (const workflow of blueprint.workflows ?? []) {
      const analysis = analyzeTransactionalWorkflow(workflow, blueprint.commands ?? [])
      if (workflow.transactional && !analysis.d1BatchEligible) {
        const reason = analysis.reasons.join('; ')
        throw new Error(`Cloudflare Workers workflow ${workflow.name} is unsupported: ${reason}`)
      }
      this.workflows.set(workflow.name, workflow)
    }
  }

  has(name: string): boolean {
    return this.workflows.has(name)
  }

  list(): Workflow[] {
    return [...this.workflows.values()]
  }

  getJob(id: string): WorkersWorkflowJob | undefined {
    return this.jobs.get(id)
  }

  async triggerManual(name: string, data: Record<string, unknown>, session?: UserSession): Promise<WorkersWorkflowJob> {
    const context: WorkflowContext = {
      trigger: { type: 'manual', data },
      variables: { data },
      session,
    }
    return this.execute(name, context, session)
  }

  async triggerSchedule(cron: string): Promise<WorkersWorkflowJob[]> {
    const jobs = []
    for (const workflow of this.workflows.values()) {
      if (workflow.trigger.schedule !== cron) continue
      jobs.push(await this.execute(workflow.name, { trigger: { type: 'schedule' }, variables: { timestamp: new Date().toISOString() }, session: SYSTEM_SESSION }, SYSTEM_SESSION))
    }
    return jobs
  }

  /** The caller must authenticate webhook requests before authorizing a workflow. */
  async triggerWebhook(path: string, request: { headers: Record<string, string>; body?: unknown; query?: Record<string, string> }, authorize: (workflow: Workflow) => boolean): Promise<WorkersWorkflowJob[]> {
    const jobs = []
    for (const workflow of this.workflows.values()) {
      if (workflow.trigger.webhook !== path || !authorize(workflow)) continue
      jobs.push(await this.execute(workflow.name, { trigger: { type: 'webhook', data: request.body }, variables: { webhook: request }, session: SYSTEM_SESSION }, SYSTEM_SESSION))
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
  ): Promise<WorkersWorkflowJob[]> {
    const jobs: WorkersWorkflowJob[] = []
    for (const workflow of this.workflows.values()) {
      if (workflowPath.length >= 5 || workflowPath.includes(workflow.name)) continue
      if (workflow.trigger.entity !== entity || workflow.trigger.event !== event) continue
      const context: WorkflowContext = {
        trigger: { type: 'entity', entity, event, data: after, before, after },
        variables: { entity: after, before, after, __zebric: { workflowPath } },
        session: session ?? SYSTEM_SESSION,
      }
      if (workflow.trigger.condition && !evaluateCondition(workflow.trigger.condition, { ...after, ...context, before, after })) continue
      jobs.push(await this.execute(workflow.name, context, session ?? SYSTEM_SESSION))
    }
    return jobs
  }

  private async execute(name: string, context: WorkflowContext, ownerSession?: UserSession): Promise<WorkersWorkflowJob> {
    const workflow = this.workflows.get(name)
    if (!workflow) throw new Error(`Workflow not found: ${name}`)
    if (workflow.precondition && !evaluateCondition(workflow.precondition, context)) {
      throw new Error(`Workflow precondition failed: ${name}`)
    }

    const propagation = (context.variables.__zebric ??= {})
    propagation.workflowPath = [...(propagation.workflowPath ?? []), name]
    propagation.currentWorkflow = name
    const now = new Date().toISOString()
    const job: WorkersWorkflowJob = {
      id: crypto.randomUUID(),
      workflowName: name,
      status: 'running',
      ownerId: securityId(ownerSession),
      createdAt: now,
      startedAt: now,
    }
    this.evictJobs()
    this.jobs.set(job.id, job)

    try {
      if (workflow.transactional) {
        const statements = []
        for (const step of workflow.steps) statements.push(...await this.compileStep(step, context))
        await this.db.batch(statements)
      } else {
        await this.executeSteps(workflow.steps, context)
      }
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
      job.result = workflow.transactional ? { workflow: name, mutations: workflow.steps.length } : context.variables
    } catch (error) {
      console.error(`Workflow ${name} failed:`, error)
      job.status = 'failed'
      job.completedAt = new Date().toISOString()
      job.error = 'Workflow execution failed'
    }
    return job
  }

  private async executeSteps(steps: WorkflowStep[], context: WorkflowContext): Promise<any[]> {
    const results = []
    for (const step of steps) {
      const result = await this.executeStep(step, context)
      if (step.assignTo && result !== undefined) context.variables[step.assignTo] = result
      results.push(result)
    }
    return results
  }

  private async executeStep(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    const resolve = (value: unknown): any => resolveValue(value, context)
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
          await this.triggerEntity(step.entity, 'create', undefined, created, context.session, context.variables.__zebric.workflowPath)
          return created
        }
        const id = typeof where === 'string' ? where : where?.id
        if (id == null) throw new Error('Mutation requires an id in the where clause')
        const before = await this.queries.findById(step.entity, String(id), queryContext)
        if (step.action === 'update') {
          if (!data) throw new Error('Update action requires data')
          // Use the guarded batch compiler to preserve additional where predicates.
          const statements = await this.queries.prepareBatchMutation(step.entity, 'update', data, typeof where === 'string' ? { id: where } : where, queryContext)
          await this.db.batch(statements)
          const updated = await this.queries.findById(step.entity, String(id), queryContext)
          await this.triggerEntity(step.entity, 'update', before, updated, context.session, context.variables.__zebric.workflowPath)
          return updated
        }
        if (step.action === 'delete') {
          await this.db.batch(await this.queries.prepareBatchMutation(step.entity, 'delete', undefined, typeof where === 'string' ? { id: where } : where, queryContext))
          await this.triggerEntity(step.entity, 'delete', before, undefined, context.session, context.variables.__zebric.workflowPath)
          return { deleted: true }
        }
        throw new Error('Unknown query action')
      }
      case 'command': {
        if (!this.integrations.commandExecutor || !step.command || !step.recordId) throw new Error('Command step is not configured')
        const definition = this.integrations.commandExecutor.registry.get(step.command)
        const before = definition ? await this.queries.findById(definition.entity, String(resolve(step.recordId)), queryContext) : undefined
        const result = await this.integrations.commandExecutor.execute({ command: step.command, recordId: String(resolve(step.recordId)), input: resolve(step.input) ?? {}, context: { session: context.session, source: 'workflow', workflow: context.variables.__zebric.currentWorkflow, workflowContext: context.variables } })
        if (definition) await this.triggerEntity(definition.entity, 'update', before, result.record, context.session, context.variables.__zebric.workflowPath)
        return result.record
      }
      case 'service':
        if (!this.integrations.services || !step.service || !step.operation) throw new Error('Service step is not configured')
        return this.integrations.services.invoke(step.service, step.operation, resolve(step.params) ?? {}, { actor: context.session?.actor ? { ...context.session.actor, roles: context.session.actor.roles ?? [], scopes: context.session.actor.scopes ?? [] } : undefined, workflow: context.variables.__zebric.currentWorkflow, workflowContext: context.variables })
      case 'condition':
        if (!step.if) throw new Error('Condition step requires if')
        await this.executeSteps(evaluateCondition(step.if, context) ? step.then ?? [] : step.else ?? [], context)
        return
      case 'loop': {
        if (!step.items || !step.do) throw new Error('Loop step requires items and do')
        const items = getPath(context, step.items.replace(/^\s*\{\{|\}\}\s*$/g, '').trim()) ?? resolve(step.items)
        if (!Array.isArray(items)) throw new Error('Loop items must be an array')
        const results = []
        for (const [index, item] of items.entries()) {
          const nested = { ...context, variables: { ...context.variables, item, index } }
          results.push(...await this.executeSteps(step.do, nested))
        }
        return results
      }
      case 'delay':
        if (!Number.isFinite(step.duration) || Number(step.duration) < 0) throw new Error('Delay requires a non-negative duration')
        await new Promise(resolve => setTimeout(resolve, step.duration))
        return
      case 'webhook': {
        if (!step.url) throw new Error('Webhook step requires url')
        const options = { method: step.method ?? 'POST', headers: resolve(step.headers), body: resolve(step.payload) }
        if (this.integrations.httpClient) return this.integrations.httpClient.request(resolve(step.url), options)
        const response = await fetch(resolve(step.url), { method: options.method, headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) })
        if (!response.ok) throw new Error(`Webhook failed: ${response.status}`)
        return response.status === 204 ? undefined : response.json()
      }
      case 'email':
        if (!this.integrations.emailService || !step.to || !step.subject) throw new Error('Email step is not configured')
        return this.integrations.emailService.send(resolve(step.to), resolve(step.subject), resolve(step.body) ?? '', step.template)
      case 'notify':
        if (!this.integrations.notificationService) throw new Error('Notification service is not configured')
        return this.integrations.notificationService.send(Object.fromEntries(['adapter', 'channel', 'to', 'subject', 'body', 'template', 'params', 'metadata'].map(key => [key, resolve((step as any)[key])])))
      case 'plugin': {
        if (!step.plugin || !step.action_name) throw new Error('Plugin step requires plugin and action_name')
        const action = this.integrations.pluginRegistry?.getPlugin(step.plugin)?.actions?.[step.action_name]
        if (!action) throw new Error('Plugin action is not configured')
        return action(resolve(step.params) ?? {}, context)
      }
      default: throw new Error(`Unsupported workflow step: ${step.type}`)
    }
  }

  /** Jobs live in isolate memory; drop expired ones and cap the total. */
  private evictJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS
    for (const [id, job] of this.jobs) {
      if (Date.parse(job.createdAt) < cutoff) this.jobs.delete(id)
    }
    while (this.jobs.size >= MAX_JOBS) {
      const oldest = this.jobs.keys().next().value
      if (oldest === undefined) break
      this.jobs.delete(oldest)
    }
  }

  private async compileStep(step: WorkflowStep, context: WorkflowContext): Promise<Array<{ sql: string; params: unknown[] }>> {
    if (step.type !== 'query' || !step.entity || !['create', 'update', 'delete'].includes(String(step.action))) {
      throw new Error(`Unsupported D1 workflow step: ${String(step.type)}`)
    }
    const action = step.action as 'create' | 'update' | 'delete'
    const data = step.data ? resolveValue(step.data, context) as Record<string, unknown> : undefined
    const where = step.where ? resolveValue(step.where, context) as Record<string, unknown> : undefined
    return this.queries.prepareBatchMutation(step.entity, action, data, where, { session: context.session })
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
  if (Array.isArray(value)) return value.map(entry => resolveValue(entry, context))
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
