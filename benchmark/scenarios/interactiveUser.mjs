import { sleep } from '../lib/runtime.mjs'

export function createInteractiveUserScenario(context) {
  const requestHeaders = context.requestHeaders ?? {}
  const weightedOperations = Object.entries(context.profile.weights)
  const totalWeight = weightedOperations.reduce((sum, [, weight]) => sum + weight, 0)

  async function postJson(path, body) {
    return fetch(`${context.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function putJson(path, body) {
    return fetch(`${context.baseUrl}${path}`, {
      method: 'PUT',
      headers: { ...requestHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function performOperation(operation) {
    const startedAt = performance.now()
    let response
    try {
      switch (operation) {
        case 'listRequests': {
          const teamId = context.catalog.teamIds[Math.floor(Math.random() * context.catalog.teamIds.length)]
          const path = Math.random() < 0.35
            ? '/requests'
            : Math.random() < 0.5
              ? '/requests/open'
              : Math.random() < 0.5
                ? '/requests/high-priority'
                : `/teams/${teamId}/requests`
          response = await fetch(`${context.baseUrl}${path}`, { headers: requestHeaders })
          break
        }
        case 'openRequestDetail': {
          const requestId = context.catalog.requestIds[Math.floor(Math.random() * context.catalog.requestIds.length)]
          response = await fetch(`${context.baseUrl}/requests/${requestId}`, { headers: requestHeaders })
          break
        }
        case 'readDashboard':
          response = await fetch(`${context.baseUrl}/`, { headers: requestHeaders })
          break
        case 'createRequest': {
          const teamId = context.catalog.teamIds[Math.floor(Math.random() * context.catalog.teamIds.length)]
          const createdByUserId = context.catalog.userIds[Math.floor(Math.random() * context.catalog.userIds.length)]
          const assignedToUserId = context.catalog.userIds[Math.floor(Math.random() * context.catalog.userIds.length)]
          response = await postJson('/api/requests', {
            teamId,
            createdByUserId,
            assignedToUserId,
            title: `Interactive request ${Date.now()}`,
            description: 'Created by The Big Zebra interactive scenario.',
            priority: 'normal',
            status: 'new',
          })
          if (response.ok) {
            const created = await response.clone().json()
            await Promise.allSettled([
              postJson('/api/auditevents', {
                requestId: created.id,
                actorUserId: createdByUserId,
                eventType: 'request.created',
                payload: { source: 'interactive_user' },
              }),
              postJson('/api/workflowruns', {
                requestId: created.id,
                workflowType: 'request_created',
                status: 'pending',
                payload: { source: 'interactive_user' },
              }),
              postJson('/api/approvalsteps', {
                requestId: created.id,
                approverUserId: assignedToUserId,
                stepOrder: 1,
                status: 'pending',
              }),
            ])
          }
          break
        }
        case 'addComment': {
          const requestId = context.catalog.requestIds[Math.floor(Math.random() * context.catalog.requestIds.length)]
          const authorUserId = context.catalog.userIds[Math.floor(Math.random() * context.catalog.userIds.length)]
          response = await postJson('/api/requestcomments', {
            requestId,
            authorUserId,
            body: 'Benchmark comment added during mixed workload run.',
          })
          if (response.ok) {
            await postJson('/api/auditevents', {
              requestId,
              actorUserId: authorUserId,
              eventType: 'comment.added',
              payload: { source: 'interactive_user' },
            }).catch(() => {})
          }
          break
        }
        case 'assignRequest': {
          const requestId = context.catalog.requestIds[Math.floor(Math.random() * context.catalog.requestIds.length)]
          const assignedToUserId = context.catalog.userIds[Math.floor(Math.random() * context.catalog.userIds.length)]
          response = await putJson(`/api/requests/${requestId}`, { assignedToUserId })
          if (response.ok) {
            await Promise.allSettled([
              postJson('/api/auditevents', {
                requestId,
                actorUserId: assignedToUserId,
                eventType: 'request.assigned',
                payload: { source: 'interactive_user' },
              }),
              postJson('/api/notifications', {
                requestId,
                recipientUserId: assignedToUserId,
                channel: 'http',
                status: 'pending',
                payload: { type: 'assignment' },
              }),
            ])
          }
          break
        }
        case 'changeStatus': {
          const requestId = context.catalog.requestIds[Math.floor(Math.random() * context.catalog.requestIds.length)]
          const nextStatus = ['triage', 'in_progress', 'awaiting_approval', 'approved', 'done'][Math.floor(Math.random() * 5)]
          response = await putJson(`/api/requests/${requestId}`, { status: nextStatus })
          if (response.ok) {
            await Promise.allSettled([
              postJson('/api/auditevents', {
                requestId,
                eventType: 'request.status_changed',
                payload: { to: nextStatus, source: 'interactive_user' },
              }),
              postJson('/api/workflowruns', {
                requestId,
                workflowType: 'status_changed',
                status: 'pending',
                payload: { to: nextStatus, source: 'interactive_user' },
              }),
            ])
          }
          break
        }
        case 'completeApproval': {
          if (!context.catalog.approvalIds.length) {
            return
          }
          const approvalId = context.catalog.approvalIds[Math.floor(Math.random() * context.catalog.approvalIds.length)]
          response = await putJson(`/api/approvalsteps/${approvalId}`, { status: 'approved' })
          break
        }
        default:
          throw new Error(`Unsupported operation ${operation}`)
      }

      const latencyMs = performance.now() - startedAt
      if (!response?.ok) {
        const body = response ? await response.text() : 'no-response'
        context.metrics.record(operation, latencyMs, false, body)
      } else {
        context.metrics.record(operation, latencyMs, true)
      }
    } catch (error) {
      const latencyMs = performance.now() - startedAt
      context.metrics.record(operation, latencyMs, false, error instanceof Error ? error.message : String(error))
    }
  }

  function chooseOperation() {
    let target = Math.random() * totalWeight
    for (const [operation, weight] of weightedOperations) {
      target -= weight
      if (target <= 0) {
        return operation
      }
    }
    return weightedOperations[0][0]
  }

  return {
    async start(loopIndex, getDesiredConcurrency, isRunning) {
      while (isRunning()) {
        if (loopIndex >= getDesiredConcurrency()) {
          await sleep(200)
          continue
        }
        await performOperation(chooseOperation())
        await sleep(40 + Math.floor(Math.random() * 120))
      }
    },
  }
}
