import { nowIso, sleep } from '../lib/runtime.mjs'

function createSqlHelpers(connection) {
  const sqlite = connection.getSQLite()
  const postgres = connection.getPostgres()

  if (sqlite) {
    return {
      async selectPending(limit) {
        return sqlite.prepare(
          "SELECT id, request_id, recipient_user_id, payload, attempts FROM notification WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?"
        ).all(limit)
      },
      async markDelivered(id) {
        sqlite.prepare(
          "UPDATE notification SET status = 'delivered', delivered_at = ?, attempts = attempts + 1 WHERE id = ?"
        ).run(nowIso(), id)
      },
      async markRetry(id) {
        sqlite.prepare(
          "UPDATE notification SET status = 'pending', attempts = attempts + 1 WHERE id = ?"
        ).run(id)
      },
      async markFailed(id) {
        sqlite.prepare(
          "UPDATE notification SET status = 'failed', attempts = attempts + 1 WHERE id = ?"
        ).run(id)
      },
    }
  }

  return {
    async selectPending(limit) {
      return postgres.unsafe(
        `SELECT id, request_id, recipient_user_id, payload, attempts FROM notification WHERE status = 'pending' ORDER BY created_at ASC LIMIT ${Number(limit)}`
      )
    },
    async markDelivered(id) {
      await postgres.unsafe(
        `UPDATE notification SET status = 'delivered', delivered_at = '${nowIso()}', attempts = attempts + 1 WHERE id = '${id}'`
      )
    },
    async markRetry(id) {
      await postgres.unsafe(
        `UPDATE notification SET status = 'pending', attempts = attempts + 1 WHERE id = '${id}'`
      )
    },
    async markFailed(id) {
      await postgres.unsafe(
        `UPDATE notification SET status = 'failed', attempts = attempts + 1 WHERE id = '${id}'`
      )
    },
  }
}

export function createNotificationPoller({
  connection,
  metrics,
  sinkUrl,
}) {
  const helpers = createSqlHelpers(connection)

  return {
    async start(isRunning) {
      while (isRunning()) {
        const pending = await helpers.selectPending(25)
        if (!pending.length) {
          await sleep(250)
          continue
        }

        for (const row of pending) {
          if (!isRunning()) break
          const startedAt = performance.now()
          try {
            const response = await fetch(`${sinkUrl}/deliver`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                id: row.id,
                requestId: row.request_id,
                recipientUserId: row.recipient_user_id,
                payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
              }),
            })
            if (response.ok) {
              await helpers.markDelivered(row.id)
              metrics?.record('sendNotification', performance.now() - startedAt, true)
            } else if ((row.attempts ?? 0) >= 2) {
              await helpers.markFailed(row.id)
              metrics?.record('sendNotification', performance.now() - startedAt, false, await response.text())
            } else {
              await helpers.markRetry(row.id)
              metrics?.record('sendNotification', performance.now() - startedAt, false, await response.text())
            }
          } catch (error) {
            if ((row.attempts ?? 0) >= 2) {
              await helpers.markFailed(row.id)
            } else {
              await helpers.markRetry(row.id)
            }
            metrics?.record('sendNotification', performance.now() - startedAt, false, error instanceof Error ? error.message : String(error))
          }
        }
      }
    },
  }
}
