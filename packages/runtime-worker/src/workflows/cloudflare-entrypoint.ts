import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { ZebricWorkersEngine, type WorkersHandlerConfig, type WorkersEnv } from '../engine.js'
import type { DurableWorkflowPayload } from './durable-workflow.js'

/**
 * Export a named subclass from the Worker and point its Workflows binding at it.
 * The resolver allows adapters to be constructed from this isolate's bindings.
 * This module has a separate export so Node tooling never imports cloudflare:workers.
 */
export function createWorkflowEntrypoint(
  config: WorkersHandlerConfig
): typeof WorkflowEntrypoint<WorkersEnv, DurableWorkflowPayload> {
  return class ZebricWorkflowEntrypoint extends WorkflowEntrypoint<WorkersEnv, DurableWorkflowPayload> {
    async run(event: WorkflowEvent<DurableWorkflowPayload>, step: WorkflowStep): Promise<Record<string, unknown>> {
      const engine = new ZebricWorkersEngine({
        ...(typeof config === 'function' ? config(this.env) : config),
        env: this.env
      })
      await engine.ensureReady()
      return engine.getWorkflowExecutor().runDurable(event.payload, step)
    }
  }
}
