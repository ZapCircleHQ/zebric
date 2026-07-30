import { describe, it, expect } from 'vitest'
import { SYSTEM_SESSION } from '@zebric/runtime-core'
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

  it('rejects manual triggers when workflow preconditions fail', () => {
    const manager = new WorkflowManager({
      dataLayer: {} as any
    })

    const workflow: Workflow = {
      name: 'complete-request',
      trigger: { manual: true },
      precondition: {
        'variables.data.record.status': 'approved',
      },
      steps: []
    }

    manager.registerWorkflow(workflow)

    expect(() => manager.trigger('complete-request', {
      record: { id: 'req_1', status: 'submitted' },
    })).toThrow('Workflow precondition failed: complete-request')
  })

  it('runs entity-triggered workflows as SYSTEM_SESSION, not the (often anonymous) HTTP caller', async () => {
    const manager = new WorkflowManager({
      dataLayer: {} as any
    })

    manager.registerWorkflow({
      name: 'on-request-update',
      trigger: { entity: 'Request', event: 'update' },
      steps: [],
    })

    const jobs = await manager.triggerEntityEvent('Request', 'update', {
      before: { id: 'req_1', status: 'triage' },
      after: { id: 'req_1', status: 'resolved' },
    })

    expect(jobs[0]?.context.session).toBe(SYSTEM_SESSION)
  })

  it('runs webhook- and schedule-triggered workflows as SYSTEM_SESSION', async () => {
    const manager = new WorkflowManager({
      dataLayer: {} as any
    })

    manager.registerWorkflow({
      name: 'on-webhook',
      trigger: { webhook: '/webhooks/github' },
      steps: [],
    })
    manager.registerWorkflow({
      name: 'on-schedule',
      trigger: { schedule: '0 0 * * *' },
      steps: [],
    })

    const webhookJobs = await manager.triggerWebhook('/webhooks/github', { headers: {} })
    const scheduleJobs = await manager.triggerSchedule('0 0 * * *')

    expect(webhookJobs[0]?.context.session).toBe(SYSTEM_SESSION)
    expect(scheduleJobs[0]?.context.session).toBe(SYSTEM_SESSION)
  })

  it('does not run manual triggers as SYSTEM_SESSION when the caller is anonymous', () => {
    const manager = new WorkflowManager({
      dataLayer: {} as any
    })

    manager.registerWorkflow({
      name: 'manual-anonymous',
      trigger: { manual: true },
      steps: [],
    })

    const job = manager.trigger('manual-anonymous', { session: null })

    expect(job.context.session).not.toBe(SYSTEM_SESSION)
    expect(job.context.session).toBeUndefined()
  })
})
