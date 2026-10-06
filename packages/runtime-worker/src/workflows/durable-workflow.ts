import type { Workflow as BlueprintWorkflow, UserSession } from '@zebric/runtime-core'
import type { WorkflowContext, WorkersWorkflowJob } from './d1-workflow-executor.js'
import type { D1Adapter } from '../database/d1-adapter.js'

/** Payloads are private to the Workflows binding; never return them from job APIs. */
export interface DurableWorkflowPayload {
  job: WorkersWorkflowJob
  workflow: BlueprintWorkflow
  context: WorkflowContext
}

export interface DurableWorkflowStep {
  do<T>(
    name: string,
    config: { retries: { limit: number; delay: number; backoff: 'linear' }; timeout: number },
    callback: () => Promise<T>
  ): Promise<T>
  sleep(name: string, duration: number): Promise<void>
}

export type DurableWorkflowBinding = Pick<Workflow<DurableWorkflowPayload>, 'create' | 'get'>

// The binding persists execution state. D1 persists the owner and workflow metadata
// needed to authorize polling from any isolate before querying the binding.
export class D1WorkflowJobStore {
  private ready?: Promise<void>
  constructor(private readonly db: D1Adapter) {}

  private initialize(): Promise<void> {
    return (this.ready ??= this.db
      .query(
        `CREATE TABLE IF NOT EXISTS _zebric_workflow_jobs (
      id TEXT PRIMARY KEY, workflow_name TEXT NOT NULL, owner_id TEXT,
      created_at TEXT NOT NULL, job_json TEXT NOT NULL
    )`
      )
      .then(async () => {
        await this.db.query(`CREATE TABLE IF NOT EXISTS _zebric_workflow_job_controls (
          job_id TEXT PRIMARY KEY REFERENCES _zebric_workflow_jobs(id) ON DELETE CASCADE,
          token TEXT NOT NULL, expires_at INTEGER NOT NULL
        )`)
      })
      .catch((error) => {
        this.ready = undefined
        throw error
      }))
  }

  async put(job: WorkersWorkflowJob): Promise<void> {
    await this.initialize()
    await this.db.query(
      `INSERT INTO _zebric_workflow_jobs (id, workflow_name, owner_id, created_at, job_json)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      [job.id, job.workflowName, job.ownerId ?? null, job.createdAt, JSON.stringify(job)]
    )
  }

  async get(id: string): Promise<WorkersWorkflowJob | undefined> {
    await this.initialize()
    const { rows } = await this.db.query<{ job_json: string }>(
      'SELECT job_json FROM _zebric_workflow_jobs WHERE id = ?',
      [id]
    )
    return rows[0] ? (JSON.parse(rows[0].job_json) as WorkersWorkflowJob) : undefined
  }

  async update(job: WorkersWorkflowJob, expected?: WorkersWorkflowJob): Promise<void> {
    await this.initialize()
    await this.db.query(`UPDATE _zebric_workflow_jobs SET job_json = ? WHERE id = ?${expected ? ' AND job_json = ?' : ''}`,
      [JSON.stringify(job), job.id, ...(expected ? [JSON.stringify(expected)] : [])])
  }

  async list(
    filter: { status?: WorkersWorkflowJob['status']; workflowName?: string; ownerId?: string } = {}
  ): Promise<WorkersWorkflowJob[]> {
    await this.initialize()
    const clauses: string[] = []
    const params: unknown[] = []
    if (filter.workflowName) {
      clauses.push('workflow_name = ?')
      params.push(filter.workflowName)
    }
    if (filter.ownerId) {
      clauses.push('owner_id = ?')
      params.push(filter.ownerId)
    }
    const { rows } = await this.db.query<{ job_json: string }>(
      `SELECT job_json FROM _zebric_workflow_jobs${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 1000`,
      params
    )
    return rows.map((row) => JSON.parse(row.job_json) as WorkersWorkflowJob)
  }

  /** Serialize native lifecycle calls across isolates; expired leases recover after a crash. */
  async withControl<T>(id: string, operation: () => Promise<T>): Promise<T | undefined> {
    await this.initialize()
    const token = crypto.randomUUID()
    const now = Date.now()
    const { rows } = await this.db.query<{ token: string }>(
      `INSERT INTO _zebric_workflow_job_controls (job_id, token, expires_at)
      VALUES (?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
      WHERE expires_at <= ? RETURNING token`,
      [id, token, now + 60000, now]
    )
    if (rows[0]?.token !== token) return undefined
    try {
      return await operation()
    } finally {
      await this.db.query('DELETE FROM _zebric_workflow_job_controls WHERE job_id = ? AND token = ?', [id, token])
    }
  }

  async cleanup(olderThanMs: number): Promise<number> {
    await this.initialize()
    const { rows } = await this.db.query(
      `DELETE FROM _zebric_workflow_jobs
      WHERE json_extract(job_json, '$.status') IN ('completed', 'failed', 'cancelled')
      AND json_extract(job_json, '$.completedAt') < ?
      AND NOT EXISTS (SELECT 1 FROM _zebric_workflow_job_controls WHERE job_id = _zebric_workflow_jobs.id AND expires_at > ?) RETURNING id`,
      [new Date(Date.now() - olderThanMs).toISOString(), Date.now()]
    )
    return rows.length
  }
}

export function sanitizedSession(session?: UserSession): UserSession | undefined {
  // Auth providers may attach methods or secrets to sessions. Only retain the
  // serializable principal needed by the shared policy/query pipeline.
  if (!session) return undefined
  const { id, user, userId, actor, expiresAt, createdAt } = session
  return JSON.parse(JSON.stringify({ id, user, userId, actor, expiresAt, createdAt })) as UserSession
}
