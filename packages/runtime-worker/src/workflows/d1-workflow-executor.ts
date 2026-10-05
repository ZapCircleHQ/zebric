import {
  SYSTEM_SESSION,
  analyzeTransactionalWorkflow,
  evaluateCondition,
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

interface WorkflowContext {
  trigger: {
    type: 'manual' | 'entity'
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

/** Executes the strict subset of workflows D1 can preserve atomically. */
export class D1WorkflowExecutor {
  private readonly workflows = new Map<string, Workflow>()
  private readonly jobs = new Map<string, WorkersWorkflowJob>()

  constructor(
    blueprint: Blueprint,
    private readonly db: D1Adapter,
    private readonly queries: WorkersQueryExecutor,
  ) {
    for (const workflow of blueprint.workflows ?? []) {
      const analysis = analyzeTransactionalWorkflow(workflow, blueprint.commands ?? [])
      if (!workflow.transactional || !analysis.d1BatchEligible) {
        const reason = !workflow.transactional
          ? 'workflow must declare transactional = true'
          : analysis.reasons.join('; ')
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

  async triggerEntity(
    entity: string,
    event: 'create' | 'update' | 'delete',
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
    session?: UserSession | null,
  ): Promise<WorkersWorkflowJob[]> {
    const jobs: WorkersWorkflowJob[] = []
    for (const workflow of this.workflows.values()) {
      if (workflow.trigger.entity !== entity || workflow.trigger.event !== event) continue
      const context: WorkflowContext = {
        trigger: { type: 'entity', entity, event, data: after, before, after },
        variables: { entity: after, before, after },
        session: session ?? SYSTEM_SESSION,
      }
      if (workflow.trigger.condition && !evaluateCondition(workflow.trigger.condition, context)) continue
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
      const statements = []
      for (const step of workflow.steps) {
        statements.push(...await this.compileStep(step, context))
      }
      await this.db.batch(statements)
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
      job.result = { workflow: name, mutations: workflow.steps.length }
    } catch (error) {
      console.error(`Workflow ${name} failed:`, error)
      job.status = 'failed'
      job.completedAt = new Date().toISOString()
      job.error = 'Workflow execution failed'
    }
    return job
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
