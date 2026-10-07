import { createHash } from 'node:crypto'
import type { DurableReceipt } from '../database/query-executor.js'
import type { Workflow } from './types.js'
import { WorkflowStore, WorkflowSuspended, WorkflowLeaseLostError, type StoredWorkflow } from './workflow-store.js'

export interface WorkflowStepRunner {
  readonly identity: string
  run(
    key: string,
    operation: (signal: AbortSignal) => Promise<any>,
    options?: { atomic?: boolean; receipt?: DurableReceipt }
  ): Promise<any>
  delay(key: string, duration: number): Promise<void>
  receipt?(key: string, fingerprint: string): DurableReceipt
}

export class DurableStepRunner implements WorkflowStepRunner {
  readonly identity: string
  constructor(
    private store: WorkflowStore,
    private job: StoredWorkflow,
    private workflow: Workflow,
    private signal: AbortSignal,
    private retryDelay = 1000
  ) {
    this.identity = JSON.stringify([job.id, job.generation])
  }
  async run(
    key: string,
    operation: (signal: AbortSignal) => Promise<any>,
    options: { atomic?: boolean; receipt?: DurableReceipt } = {}
  ): Promise<any> {
    this.signal.throwIfAborted()
    const cached = await this.store.checkpoint(this.job, key)
    if (cached.found) return cached.value
    const maximum = Math.max(1, this.workflow.retries ?? 3)
    const attempt = await this.store.beginAttempt(this.job, key, maximum)
    this.signal.throwIfAborted()
    const controller = new AbortController()
    const abort = () => controller.abort(this.signal.reason)
    this.signal.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    const effect = async () => {
      await this.store.assertOwned(this.job)
      controller.signal.throwIfAborted()
      const cancelled = new Promise<never>((_, reject) => {
        const onAbort = () => reject(controller.signal.reason ?? new Error('Workflow cancelled'))
        controller.signal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(
          () => controller.abort(new Error('Workflow effect timed out')),
          this.workflow.timeout ?? 30000
        )
      })
      const result = await Promise.race([
        cancelled,
        this.store.db.withAbortSignal(controller.signal, () => operation(controller.signal))
      ])
      controller.signal.throwIfAborted()
      this.signal.throwIfAborted()
      if (options.atomic) await this.store.saveCheckpoint(this.job, key, result)
      return result
    }
    try {
      const value = options.atomic
        ? await this.store.db.transaction(effect, options.receipt, controller.signal)
        : await effect()
      if (!options.atomic || !(await this.store.checkpoint(this.job, key)).found)
        await this.store.db.transaction(() => this.store.saveCheckpoint(this.job, key, value), undefined, this.signal)
      return value
    } catch (error) {
      if (
        error instanceof WorkflowSuspended ||
        error instanceof WorkflowLeaseLostError ||
        this.signal.aborted ||
        attempt >= maximum
      )
        throw error
      const until = this.store.now() + this.retryDelay * attempt
      await this.store.scheduleRetry(this.job, key, until)
      throw new WorkflowSuspended(until)
    } finally {
      if (timer) clearTimeout(timer)
      this.signal.removeEventListener('abort', abort)
      controller.abort(new Error('Workflow effect is no longer active'))
    }
  }
  async delay(key: string, duration: number): Promise<void> {
    this.signal.throwIfAborted()
    if (!Number.isFinite(duration) || duration < 0) throw new Error('Invalid delay duration')
    await this.store.delay(this.job, key, duration)
  }
  receipt(key: string, fingerprint: string): DurableReceipt {
    return {
      key: JSON.stringify(['workflow', this.job.id, key]),
      fingerprint: createHash('sha256').update(fingerprint).digest('hex')
    }
  }
}

export function wait(duration: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    const timer = setTimeout(finish, duration)
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
