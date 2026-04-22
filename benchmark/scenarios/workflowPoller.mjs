import { nowIso, sleep } from '../lib/runtime.mjs'

function parseJson(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function createSqlHelpers(connection) {
  const sqlite = connection.getSQLite()
  const postgres = connection.getPostgres()

  if (sqlite) {
    return {
      async selectPending(limit) {
        return sqlite.prepare(
          "SELECT id, request_id, workflow_type, attempts, payload FROM workflow_run WHERE status = 'pending' ORDER BY started_at ASC LIMIT ?"
        ).all(limit)
      },
      async claim(id, workerId) {
        const result = sqlite.prepare(
          "UPDATE workflow_run SET status = 'running', claimed_by = ?, claimed_at = ? WHERE id = ? AND status = 'pending'"
        ).run(workerId, nowIso(), id)
        return result.changes === 1
      },
      async complete(id, status) {
        sqlite.prepare(
          "UPDATE workflow_run SET status = ?, completed_at = ? WHERE id = ?"
        ).run(status, nowIso(), id)
      },
      async getRequest(requestId) {
        return sqlite.prepare('SELECT id, assigned_to_user_id, created_by_user_id FROM request WHERE id = ?').get(requestId)
      },
      async markWebhookProcessed(requestId, deliveryKey) {
        sqlite.prepare(
          "UPDATE webhook_event SET processing_status = 'processed', processed_at = ? WHERE request_id = ? AND delivery_key = ? AND processing_status = 'pending'"
        ).run(nowIso(), requestId, deliveryKey)
      },
    }
  }

  return {
    async selectPending(limit) {
      return postgres.unsafe(
        `SELECT id, request_id, workflow_type, attempts, payload FROM workflow_run WHERE status = 'pending' ORDER BY started_at ASC LIMIT ${Number(limit)}`
      )
    },
    async claim(id, workerId) {
      const result = await postgres.unsafe(
        `UPDATE workflow_run SET status = 'running', claimed_by = '${workerId}', claimed_at = '${nowIso()}' WHERE id = '${id}' AND status = 'pending' RETURNING id`
      )
      return result.length === 1
    },
    async complete(id, status) {
      await postgres.unsafe(
        `UPDATE workflow_run SET status = '${status}', completed_at = '${nowIso()}' WHERE id = '${id}'`
      )
    },
    async getRequest(requestId) {
      const result = await postgres.unsafe(
        `SELECT id, assigned_to_user_id, created_by_user_id FROM request WHERE id = '${requestId}' LIMIT 1`
      )
      return result[0]
    },
    async markWebhookProcessed(requestId, deliveryKey) {
      await postgres.unsafe(
        `UPDATE webhook_event SET processing_status = 'processed', processed_at = '${nowIso()}' WHERE request_id = '${requestId}' AND delivery_key = '${deliveryKey}' AND processing_status = 'pending'`
      )
    },
  }
}

export function createWorkflowPoller({ connection, metrics, workerId = `workflow-worker-${process.pid}` }) {
  const helpers = createSqlHelpers(connection)
  const db = connection.getDb()
  const notificationTable = connection.getTable('Notification')
  const auditTable = connection.getTable('AuditEvent')

  return {
    async start(isRunning) {
      while (isRunning()) {
        const pending = await helpers.selectPending(20)
        if (!pending.length) {
          await sleep(300)
          continue
        }

        for (const row of pending) {
          if (!isRunning()) break
          const workflowId = row.id ?? row.ID
          const requestId = row.request_id ?? row.requestId
          const workflowType = row.workflow_type ?? row.workflowType
          const claimed = await helpers.claim(workflowId, workerId)
          if (!claimed) {
            continue
          }

          const startedAt = performance.now()
          try {
            const request = requestId ? await helpers.getRequest(requestId) : null
            const payload = parseJson(row.payload)
            const recipientUserId = request?.assigned_to_user_id ?? request?.assignedToUserId ?? request?.created_by_user_id ?? request?.createdByUserId
            const timestamp = new Date()
            if (workflowType === 'webhook_received' && requestId && payload.deliveryKey) {
              await helpers.markWebhookProcessed(requestId, payload.deliveryKey)
            }
            if (requestId && recipientUserId) {
              await db.insert(notificationTable).values({
                id: `notif_run_${workflowId}`,
                request_id: requestId,
                recipient_user_id: recipientUserId,
                channel: 'http',
                status: 'pending',
                payload: {
                  workflowType,
                  payload,
                },
                created_at: timestamp,
                attempts: 0,
              })
              await db.insert(auditTable).values({
                id: `audit_run_${workflowId}`,
                request_id: requestId,
                actor_user_id: recipientUserId,
                event_type: 'workflow.processed',
                payload: { workflowType },
                created_at: timestamp,
              })
            }
            await helpers.complete(workflowId, 'completed')
            metrics?.record('processWorkflow', performance.now() - startedAt, true)
          } catch (error) {
            await helpers.complete(workflowId, 'failed')
            metrics?.record('processWorkflow', performance.now() - startedAt, false, error instanceof Error ? error.message : String(error))
          }
        }
      }
    },
  }
}
