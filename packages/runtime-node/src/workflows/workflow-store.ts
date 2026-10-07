import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { IdempotencyConflictError, type QueryExecutor } from '../database/query-executor.js'
import { encodeRuntimeValue, decodeRuntimeValue } from '../database/runtime-codec.js'
import type { Workflow, WorkflowContext, WorkflowJob } from './types.js'

export interface StoredWorkflow extends WorkflowJob {
  newlyCreated?: boolean
  generation: number
  leaseToken?: string
}
export interface WorkflowEvent {
  entity: string
  event: 'create' | 'update' | 'delete'
  before?: any
  after?: any
  sourceWorkflow?: string
  depth?: number
  workflowPath?: string[]
  trace?: WorkflowContext['trace']
  session?: WorkflowContext['session']
  attribution?: any
}
interface JobRow {
  id: string
  status: WorkflowJob['status']
  job_json: string
  workflow_json: string
  context_json: string
  generation: number
  lease_token: string | null
}
export class WorkflowLeaseLostError extends Error {
  constructor() {
    super('Workflow lease is no longer owned')
  }
}
export class WorkflowSuspended extends Error {
  constructor(readonly until: number) {
    super('Workflow is waiting for a durable delay')
  }
}

/** Durable scheduler state shared by SQLite and PostgreSQL processes. */
export class WorkflowStore {
  constructor(
    readonly db: QueryExecutor,
    readonly leaseMs = 60000,
    readonly now = Date.now
  ) {}

  async create(job: WorkflowJob, workflow: Workflow, fingerprint?: string): Promise<StoredWorkflow> {
    const context = sanitizeContext(job.context)
    const stored = { ...job, context, submissionFingerprint: fingerprint }
    const inserted = await this.db.queryRuntime(sql`INSERT INTO __zbl_workflow_jobs
      (id, workflow_name, workflow_json, context_json, status, job_json, generation, available_at)
      VALUES (${job.id}, ${job.workflowName}, ${encodeRuntimeValue(workflow)}, ${encodeRuntimeValue(context)},
        ${'pending'}, ${encodeRuntimeValue(stored)}, ${0}, ${this.now()}) ON CONFLICT(id) DO NOTHING RETURNING id`)
    const existing = (await this.get(job.id))!
    if ((existing as any).submissionFingerprint !== fingerprint) throw new IdempotencyConflictError()
    return { ...existing, newlyCreated: inserted.length > 0 }
  }

  async get(id: string): Promise<StoredWorkflow | undefined> {
    const rows = await this.db.queryRuntime<JobRow>(sql`SELECT * FROM __zbl_workflow_jobs WHERE id = ${id}`)
    return rows[0] ? this.job(rows[0]) : undefined
  }
  async list(): Promise<StoredWorkflow[]> {
    return (await this.db.queryRuntime<JobRow>(sql`SELECT * FROM __zbl_workflow_jobs ORDER BY available_at, id`)).map(
      (row) => this.job(row)
    )
  }
  private job(row: JobRow): StoredWorkflow {
    return {
      ...decodeRuntimeValue<WorkflowJob>(row.job_json),
      status: row.status,
      generation: Number(row.generation),
      leaseToken: row.lease_token ?? undefined
    }
  }

  async claim(names: string[]): Promise<{ job: StoredWorkflow; workflow: Workflow } | undefined> {
    if (!names.length) return undefined
    const now = this.now()
    const token = randomUUID()
    const eligible = sql`workflow_name IN (${sql.join(
      names.map((name) => sql`${name}`),
      sql`, `
    )})
      AND available_at <= ${now} AND (status = 'pending' OR (status = 'running' AND lease_expires_at <= ${now}))`
    const rows = await this.db.queryRuntime<JobRow>(sql`UPDATE __zbl_workflow_jobs SET status = 'running',
      lease_token = ${token}, lease_expires_at = ${now + this.leaseMs}
      WHERE id = (SELECT id FROM __zbl_workflow_jobs WHERE ${eligible} ORDER BY available_at, id LIMIT 1)
        AND ${eligible} RETURNING *`)
    if (!rows[0]) return undefined
    const job = this.job(rows[0])
    job.context = decodeRuntimeValue(rows[0].context_json)
    job.startedAt ??= new Date(now)
    job.attempts++
    job.completedAt = undefined
    job.error = undefined
    job.result = undefined
    await this.db
      .queryRuntime(sql`UPDATE __zbl_workflow_jobs SET job_json = ${encodeRuntimeValue({ ...job, leaseToken: undefined })}
      WHERE id = ${job.id} AND status = 'running' AND lease_token = ${token}`)
    return { job, workflow: decodeRuntimeValue<Workflow>(rows[0].workflow_json) }
  }

  async assertOwned(job: StoredWorkflow): Promise<void> {
    const rows = await this.db
      .queryRuntime(sql`UPDATE __zbl_workflow_jobs SET lease_expires_at = ${this.now() + this.leaseMs}
      WHERE id = ${job.id} AND status = 'running' AND generation = ${job.generation} AND lease_token = ${job.leaseToken!} AND lease_expires_at > ${this.now()} RETURNING id`)
    if (!rows.length) throw new WorkflowLeaseLostError()
  }
  async finish(job: StoredWorkflow, status: WorkflowJob['status'], result?: any, until = this.now()): Promise<boolean> {
    const completed = {
      ...job,
      status,
      result,
      leaseToken: undefined,
      completedAt: ['completed', 'failed', 'cancelled'].includes(status) ? new Date(this.now()) : undefined
    }
    const rows = await this.db.queryRuntime(sql`UPDATE __zbl_workflow_jobs SET status = ${status},
      job_json = ${encodeRuntimeValue(completed)}, available_at = ${until}, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${job.id} AND status = 'running' AND lease_token = ${job.leaseToken!} AND generation = ${job.generation} AND lease_expires_at > ${this.now()} RETURNING id`)
    return rows.length > 0
  }
  async cancel(id: string): Promise<boolean> {
    const job = await this.get(id)
    if (!job || !['pending', 'running'].includes(job.status)) return false
    job.completedAt = new Date(this.now())
    const rows = await this.db
      .queryRuntime(sql`UPDATE __zbl_workflow_jobs SET status = 'cancelled', job_json = ${encodeRuntimeValue(job)},
      lease_token = NULL, lease_expires_at = NULL WHERE id = ${id} AND status IN ('pending', 'running') RETURNING id`)
    return rows.length > 0
  }
  async retry(id: string): Promise<boolean> {
    const rows = await this.db
      .queryRuntime(sql`UPDATE __zbl_workflow_jobs SET status = 'pending', generation = generation + 1,
      available_at = ${this.now()}, lease_token = NULL, lease_expires_at = NULL WHERE id = ${id} AND status = 'failed' RETURNING id`)
    return rows.length > 0
  }
  async cleanup(before: number): Promise<number> {
    const jobs = (await this.list()).filter(
      (job) => (job as any).submissionFingerprint === undefined && job.completedAt && job.completedAt.getTime() < before
    )
    let count = 0
    for (const job of jobs)
      await this.db.transaction(async () => {
        const removed = await this.db.queryRuntime(sql`DELETE FROM __zbl_workflow_jobs WHERE id = ${job.id}
        AND status IN ('completed', 'failed', 'cancelled') RETURNING id`)
        if (removed.length) {
          await this.db.queryRuntime(sql`DELETE FROM __zbl_workflow_steps WHERE job_id = ${job.id}`)
          count++
        }
      })
    return count
  }

  async checkpoint(
    job: StoredWorkflow,
    key: string
  ): Promise<{ found: boolean; value?: any; wakeAt?: number; attempts: number; retryAt?: number }> {
    const rows = await this.db.queryRuntime<{
      value: string | null
      wake_at: number | null
      attempts: number
      retry_at: number | null
    }>(sql`SELECT value, wake_at, attempts, retry_at
      FROM __zbl_workflow_steps WHERE job_id = ${job.id} AND generation = ${job.generation} AND step_key = ${key}`)
    const row = rows[0]
    return {
      found: row?.value != null,
      value: row?.value == null ? undefined : decodeRuntimeValue(row.value),
      wakeAt: row?.wake_at == null ? undefined : Number(row.wake_at),
      attempts: Number(row?.attempts ?? 0),
      retryAt: row?.retry_at == null ? undefined : Number(row.retry_at)
    }
  }
  async saveCheckpoint(job: StoredWorkflow, key: string, value: any): Promise<void> {
    if (!this.db.inTransaction) return this.db.transaction(() => this.saveCheckpoint(job, key, value))
    await this.assertOwned(job)
    await this.db.queryRuntime(sql`INSERT INTO __zbl_workflow_steps (job_id, generation, step_key, value)
      VALUES (${job.id}, ${job.generation}, ${key}, ${encodeRuntimeValue(value)})
      ON CONFLICT (job_id, generation, step_key) DO UPDATE SET value = EXCLUDED.value`)
  }
  async beginAttempt(job: StoredWorkflow, key: string, maximum: number): Promise<number> {
    return this.db.transaction(async () => {
      await this.assertOwned(job)
      const checkpoint = await this.checkpoint(job, key)
      if (checkpoint.retryAt && checkpoint.retryAt > this.now()) throw new WorkflowSuspended(checkpoint.retryAt)
      if (checkpoint.attempts >= maximum) throw new Error('Workflow effect exhausted its retry budget')
      await this.db.queryRuntime(sql`INSERT INTO __zbl_workflow_steps (job_id, generation, step_key, attempts)
        VALUES (${job.id}, ${job.generation}, ${key}, ${1}) ON CONFLICT (job_id, generation, step_key)
        DO UPDATE SET attempts = __zbl_workflow_steps.attempts + 1, retry_at = NULL`)
      return checkpoint.attempts + 1
    })
  }
  async scheduleRetry(job: StoredWorkflow, key: string, until: number): Promise<void> {
    await this.db.transaction(async () => {
      await this.assertOwned(job)
      await this.db.queryRuntime(sql`UPDATE __zbl_workflow_steps SET retry_at = ${until}
        WHERE job_id = ${job.id} AND generation = ${job.generation} AND step_key = ${key}`)
    })
  }
  async delay(job: StoredWorkflow, key: string, duration: number): Promise<void> {
    const wakeAt = await this.db.transaction(async () => {
      await this.assertOwned(job)
      let checkpoint = await this.checkpoint(job, key)
      if (checkpoint.found) return undefined
      if (checkpoint.wakeAt === undefined) {
        await this.db.queryRuntime(sql`INSERT INTO __zbl_workflow_steps (job_id, generation, step_key, wake_at)
          VALUES (${job.id}, ${job.generation}, ${key}, ${this.now() + duration}) ON CONFLICT DO NOTHING`)
        checkpoint = await this.checkpoint(job, key)
      }
      if (checkpoint.wakeAt! > this.now()) return checkpoint.wakeAt
      await this.saveCheckpoint(job, key, undefined)
      return undefined
    })
    if (wakeAt !== undefined) throw new WorkflowSuspended(wakeAt)
  }

  async enqueueEvent(event: WorkflowEvent, id: string = randomUUID()): Promise<void> {
    if (!this.db.inTransaction) throw new Error('Workflow event intents require a transaction')
    const clean = { ...event, session: sanitizeSession(event.session) }
    await this.db.queryRuntime(sql`INSERT INTO __zbl_workflow_events (id, value, available_at)
      VALUES (${id}, ${encodeRuntimeValue(clean)}, ${this.now()}) ON CONFLICT(id) DO NOTHING`)
  }
  async drainEvents(deliver: (event: WorkflowEvent, id: string) => Promise<void>, limit = 25): Promise<void> {
    for (let index = 0; index < limit; index++) {
      const token = randomUUID()
      const now = this.now()
      const eligible = sql`delivered_at IS NULL AND available_at <= ${now} AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})`
      const rows = await this.db.queryRuntime<{
        id: string
        value: string
        attempts: number
      }>(sql`UPDATE __zbl_workflow_events
        SET lease_token = ${token}, lease_expires_at = ${now + this.leaseMs}, attempts = attempts + 1
        WHERE id = (SELECT id FROM __zbl_workflow_events WHERE ${eligible} ORDER BY available_at, id LIMIT 1)
          AND ${eligible} RETURNING id, value, attempts`)
      const row = rows[0]
      if (!row) return
      let lostLease = false
      let renewal: Promise<void> | undefined
      const heartbeat = setInterval(
        () => {
          if (renewal) return
          renewal = this.db
            .queryRuntime(
              sql`UPDATE __zbl_workflow_events SET lease_expires_at = ${this.now() + this.leaseMs}
          WHERE id = ${row.id} AND lease_token = ${token} AND lease_expires_at > ${this.now()} RETURNING id`
            )
            .then((rows) => {
              if (!rows.length) lostLease = true
            })
            .catch(() => {
              lostLease = true
            })
            .finally(() => {
              renewal = undefined
            })
        },
        Math.max(1, Math.floor(this.leaseMs / 3))
      )
      heartbeat.unref()
      try {
        await deliver(decodeRuntimeValue(row.value), row.id)
        if (lostLease) throw new WorkflowLeaseLostError()
        await this.db
          .queryRuntime(sql`UPDATE __zbl_workflow_events SET delivered_at = ${this.now()}, lease_token = NULL, lease_expires_at = NULL
          WHERE id = ${row.id} AND lease_token = ${token} AND lease_expires_at > ${this.now()}`)
      } catch {
        await this.db
          .queryRuntime(sql`UPDATE __zbl_workflow_events SET available_at = ${this.now() + Math.min(300000, 1000 * 2 ** Math.min(18, Number(row.attempts) - 1))},
          lease_token = NULL, lease_expires_at = NULL WHERE id = ${row.id} AND lease_token = ${token}`)
      } finally {
        clearInterval(heartbeat)
        await renewal
      }
    }
  }
}

export function sanitizeSession(session: any): any {
  if (!session) return session
  const { id, user, userId, actor, expiresAt, createdAt } = session
  return decodeRuntimeValue(encodeRuntimeValue({ id, user, userId, actor, expiresAt, createdAt }))
}
function sanitizeContext(context: WorkflowContext): WorkflowContext {
  const session = sanitizeSession(context.session)
  const variables = { ...context.variables }
  if (variables.data?.session) variables.data = { ...variables.data, session }
  const trigger = { ...context.trigger }
  if (trigger.data?.session) trigger.data = { ...trigger.data, session }
  return decodeRuntimeValue(encodeRuntimeValue({ ...context, session, trigger, variables }))
}
