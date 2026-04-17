import type { Blueprint } from '@zebric/runtime-core'
import { createSimulatorId } from './id.js'
import type { SimulatorLogger } from './logger.js'
import type { WorkflowStateEntry, WorkflowSummary } from './types.js'

export class SimulatorWorkflowHost {
  private entries: WorkflowStateEntry[] = []

  constructor(
    private blueprint: Blueprint,
    private logger: SimulatorLogger
  ) {}

  setBlueprint(blueprint: Blueprint): void {
    this.blueprint = blueprint
  }

  trigger(workflowName: string, payload?: unknown): WorkflowStateEntry {
    const workflow = this.blueprint.workflows?.find((candidate) => candidate.name === workflowName)
    const entry: WorkflowStateEntry = {
      id: createSimulatorId('wf'),
      timestamp: Date.now(),
      workflowName,
      status: workflow ? 'debug' : 'failed',
      payload,
      logs: workflow
        ? [
            `Workflow "${workflowName}" triggered in simulator.`,
            `Step count: ${workflow.steps.length}.`,
            'External side effects are not executed in the browser simulator.',
          ]
        : [`Workflow "${workflowName}" was not found.`],
    }

    this.entries = [entry, ...this.entries].slice(0, 100)
    this.logger.log({
      type: 'workflow',
      message: `Workflow ${workflowName} ${entry.status}`,
      detail: entry,
    })
    return entry
  }

  getEntries(): WorkflowStateEntry[] {
    return [...this.entries]
  }

  getRegisteredWorkflows(): WorkflowSummary[] {
    return (this.blueprint.workflows || []).map((workflow) => ({
      name: workflow.name,
      trigger: workflow.trigger,
      stepCount: workflow.steps.length,
      steps: workflow.steps.map((step) => step.type),
    }))
  }
}
