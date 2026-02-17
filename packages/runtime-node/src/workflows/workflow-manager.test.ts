import { describe, it, expect } from 'vitest'
import { WorkflowManager } from './workflow-manager.js'
import type { Workflow } from './types.js'

describe('WorkflowManager entity triggers', () => {
  it('provides before/after context and evaluates transition conditions', async () => {
    const manager = new WorkflowManager({
      dataLayer: {} as any
    })

    const workflow: Workflow = {
      name: 'notify-on-resolve',
      trigger: {
        entity: 'Request',
        event: 'update',
        condition: {
          'after.status': 'resolved',
          'before.status': { $ne: 'resolved' }
        }
      },
      steps: []
    }

    manager.registerWorkflow(workflow)

    const jobs = await manager.triggerEntityEvent('Request', 'update', {
      before: { id: 'req_1', status: 'triage' },
      after: { id: 'req_1', status: 'resolved' }
    })

    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.context.trigger.before?.status).toBe('triage')
    expect(jobs[0]?.context.trigger.after?.status).toBe('resolved')
    expect(jobs[0]?.context.trigger.data?.status).toBe('resolved')
    expect(jobs[0]?.context.variables.before?.status).toBe('triage')
    expect(jobs[0]?.context.variables.after?.status).toBe('resolved')
  })

  it('remains backward compatible with legacy top-level trigger conditions', async () => {
    const manager = new WorkflowManager({
      dataLayer: {} as any
    })

    const workflow: Workflow = {
      name: 'legacy-condition',
      trigger: {
        entity: 'Request',
        event: 'update',
        condition: {
          status: 'resolved'
        }
      },
      steps: []
    }

    manager.registerWorkflow(workflow)

    const jobs = await manager.triggerEntityEvent('Request', 'update', {
      before: { id: 'req_1', status: 'triage' },
      after: { id: 'req_1', status: 'resolved' }
    })

    expect(jobs).toHaveLength(1)
  })
})
