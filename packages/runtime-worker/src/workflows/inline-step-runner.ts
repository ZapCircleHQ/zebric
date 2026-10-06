import type { DurableWorkflowStep } from './durable-workflow.js'

/** Inline execution uses the same per-effect policy, with cooperative cancellation. */
export function createInlineStepRunner(
  controller: AbortController,
  onAttempt: (attempt: number) => void
): DurableWorkflowStep {
  const wait = <T>(operation: () => Promise<T>, timeout?: number): Promise<T> =>
    new Promise((resolve, reject) => {
      const signal = controller.signal
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      const abort = () => {
        cleanup()
        reject(signal.reason)
      }
      const timer =
        timeout === undefined
          ? undefined
          : setTimeout(() => controller.abort(new Error('Workflow step timed out')), timeout)
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer)
        signal.removeEventListener('abort', abort)
      }
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve()
        .then(() => {
          signal.throwIfAborted()
          return operation()
        })
        .then(
          (value) => {
            cleanup()
            resolve(value)
          },
          (error) => {
            cleanup()
            reject(error)
          }
        )
    })
  const sleep = async (_name: string, duration: number): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await wait(
        () =>
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, duration)
          })
      )
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  return {
    async do<T>(
      name: string,
      config: Parameters<DurableWorkflowStep['do']>[1],
      callback: () => Promise<T>
    ): Promise<T> {
      for (let attempt = 1; ; attempt++) {
        onAttempt(attempt)
        try {
          return await wait(callback, config.timeout)
        } catch (error) {
          // A timeout may leave an uncooperative effect in flight. Stop the job
          // instead of retrying it concurrently or continuing to another effect.
          if (controller.signal.aborted || attempt > config.retries.limit) throw error
          await sleep(`${name}.retry`, config.retries.delay * attempt)
        }
      }
    },
    sleep
  }
}
